const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const profilePath = path.resolve(__dirname, '..', 'pages', 'profile', 'profile.js');
const apiPath = path.resolve(__dirname, '..', 'utils', 'api.js');
const sessionPath = path.resolve(__dirname, '..', 'utils', 'session.js');
let profileModule;

function loadProfile({ api = {}, session = {}, storage = new Map(), modals = [] } = {}) {
  let definition;
  delete require.cache[profilePath];
  require.cache[apiPath] = {
    id: apiPath,
    filename: apiPath,
    loaded: true,
    exports: {
      getProfile: () => Promise.resolve({
        nickname: '小明',
        profile_prompt_required: false,
        student_profile_required: false,
        phone_bound: false,
        stats: {},
      }),
      downloadAvatar: () => Promise.resolve(''),
      ...api,
    },
  };
  require.cache[sessionPath] = {
    id: sessionPath,
    filename: sessionPath,
    loaded: true,
    exports: {
      logoutLocal() {},
      storeLogin() {},
      storePendingDeletion() {},
      getFreshLoginCode: () => Promise.resolve('fresh-login-code'),
      ...session,
    },
  };
  global.wx = {
    getStorageSync: key => storage.get(key),
    setStorageSync: (key, value) => storage.set(key, value),
    showToast() {},
    showModal(options) {
      const result = modals.shift() || { confirm: true, cancel: false };
      return Promise.resolve(result);
    },
    reLaunch() {},
  };
  global.Page = value => { definition = value; };
  profileModule = require(profilePath);
  return {
    page: {
      ...definition,
      data: {
        ...definition.data,
        stats: { ...definition.data.stats },
      },
      setData(values) { Object.assign(this.data, values); },
    },
    cleanup() {
      delete global.wx;
      delete global.Page;
      delete require.cache[profilePath];
      delete require.cache[apiPath];
      delete require.cache[sessionPath];
    },
  };
}

test('deletion deadline treats a timezone-less backend value as UTC', () => {
  const harness = loadProfile();

  try {
    assert.equal(
      profileModule.formatDeletionDueAt('2026-08-25T00:00:00'),
      '2026-08-25 08:00'
    );
  } finally {
    harness.cleanup();
  }
});

test('phone authorization sends only the one-time code', async () => {
  let received;
  const harness = loadProfile({
    api: {
      bindPhone(code) {
        received = code;
        return Promise.resolve({ status: 'bound', phone_masked: '138****8000' });
      },
    },
  });

  try {
    await harness.page.onGetPhoneNumber({
      detail: {
        code: 'phone-code',
        encryptedData: 'must-not-be-forwarded',
        iv: 'must-not-be-forwarded',
      },
    });
    assert.equal(received, 'phone-code');
    assert.equal(harness.page.data.phoneBound, true);
    assert.equal(harness.page.data.phoneMasked, '138****8000');
  } finally {
    harness.cleanup();
  }
});

test('phone authorization failures expose an actionable reason', () => {
  assert.equal(
    profileModule.phoneAuthorizationMessage(
      'getPhoneNumber:fail user deny'
    ),
    '已取消手机号授权'
  );
  assert.equal(
    profileModule.phoneAuthorizationMessage(
      'getPhoneNumber:fail no permission'
    ),
    '当前小程序未开通手机号能力'
  );
  assert.equal(
    profileModule.phoneAuthorizationMessage(
      'getPhoneNumber:fail api not supported'
    ),
    '当前微信环境不支持手机号授权'
  );
  assert.equal(
    profileModule.phoneAuthorizationMessage(''),
    '手机号授权失败，请稍后重试'
  );
});

test('account security actions use consistent right-side outline buttons', () => {
  const template = fs.readFileSync(
    path.resolve(__dirname, '..', 'pages', 'profile', 'profile.wxml'),
    'utf8'
  );

  assert.match(
    template,
    /class="account-action logout-action"[\s\S]*bindtap="onLogout"/
  );
  assert.match(
    template,
    /class="account-action danger-action[^"]*"[\s\S]*bindtap="onRequestDeletion"/
  );
  assert.ok(
    template.indexOf('logout-action') < template.indexOf('danger-action')
  );
});

test('recoverable phone conflict requires confirmation before replacing the session', async () => {
  let recoveredToken;
  let storedLogin;
  const harness = loadProfile({
    api: {
      bindPhone: () => Promise.reject({
        data: {
          detail: {
            code: 'account_recovery_available',
            message: '该手机号关联了已有账户，是否恢复原账户？',
            recovery_token: 'short-recovery-token',
          },
        },
      }),
      recoverAccount(token) {
        recoveredToken = token;
        return Promise.resolve({
          token: 'restored-normal-token',
          account_status: 'active',
        });
      },
    },
    session: {
      storeLogin(data) { storedLogin = data; },
    },
    modals: [{ confirm: true, cancel: false }],
  });
  harness.page.loadProfile = () => Promise.resolve();

  try {
    await harness.page.onGetPhoneNumber({ detail: { code: 'phone-code' } });
    assert.equal(recoveredToken, 'short-recovery-token');
    assert.equal(storedLogin.token, 'restored-normal-token');
  } finally {
    harness.cleanup();
  }
});

test('populated account conflict shows support reference without replacing the session', async () => {
  const shown = [];
  let stored = false;
  const harness = loadProfile({
    api: {
      bindPhone: () => Promise.reject({
        data: {
          detail: {
            code: 'account_merge_required',
            message: '两个账户均有学习数据，请联系支持处理',
            support_reference: 'SUP-20260726-001',
          },
        },
      }),
    },
    session: {
      storeLogin() { stored = true; },
    },
  });
  global.wx.showModal = options => {
    shown.push(options);
    return Promise.resolve({ confirm: true });
  };

  try {
    await harness.page.onGetPhoneNumber({ detail: { code: 'phone-code' } });
    assert.equal(stored, false);
    assert.equal(shown.length, 1);
    assert.match(shown[0].content, /SUP-20260726-001/);
    assert.equal(shown[0].showCancel, false);
  } finally {
    harness.cleanup();
  }
});

test('account deletion requires two confirmations and fresh identity verification', async () => {
  let freshCodeRequests = 0;
  let deletionCode;
  let pendingSession;
  const harness = loadProfile({
    api: {
      requestAccountDeletion(code) {
        deletionCode = code;
        return Promise.resolve({
          account_status: 'pending_deletion',
          recovery_token: 'deletion-recovery-token',
          deletion_due_at: '2026-08-25T00:00:00Z',
        });
      },
    },
    session: {
      getFreshLoginCode() {
        freshCodeRequests += 1;
        return Promise.resolve('fresh-login-code');
      },
      storePendingDeletion(data) { pendingSession = data; },
    },
    modals: [
      { confirm: true, cancel: false },
      { confirm: true, cancel: false },
    ],
  });

  try {
    await harness.page.onRequestDeletion();
    assert.equal(freshCodeRequests, 1);
    assert.equal(deletionCode, 'fresh-login-code');
    assert.equal(pendingSession.recovery_token, 'deletion-recovery-token');
    assert.equal(harness.page.data.pendingDeletion, true);
  } finally {
    harness.cleanup();
  }
});

test('repeated deletion taps do not open parallel confirmation flows', async () => {
  let resolveFirstModal;
  let modalCalls = 0;
  const harness = loadProfile();
  global.wx.showModal = options => {
    modalCalls += 1;
    if (modalCalls === 1) {
      return new Promise(resolve => { resolveFirstModal = resolve; });
    }
    return Promise.resolve({ confirm: false, cancel: true });
  };

  try {
    const first = harness.page.onRequestDeletion();
    const second = harness.page.onRequestDeletion();
    assert.equal(modalCalls, 1);
    resolveFirstModal({ confirm: false, cancel: true });
    await Promise.all([first, second]);
  } finally {
    harness.cleanup();
  }
});

test('pending-deletion profile exposes only restore and exit actions', () => {
  const template = fs.readFileSync(
    path.resolve(__dirname, '..', 'pages', 'profile', 'profile.wxml'),
    'utf8'
  );

  assert.match(template, /wx:elif="\{\{pendingDeletion\}\}"/);
  assert.match(template, /bindtap="onRecoverDeletion"/);
  assert.match(template, /bindtap="onExitPendingAccount"/);
  assert.match(template, /wx:else[\s\S]*账户与安全/);
});

test('account deletion copy does not hardcode the configurable retention days', () => {
  const script = fs.readFileSync(
    path.resolve(__dirname, '..', 'pages', 'profile', 'profile.js'),
    'utf8'
  );
  const template = fs.readFileSync(
    path.resolve(__dirname, '..', 'pages', 'profile', 'profile.wxml'),
    'utf8'
  );

  assert.equal(script.includes('30 天'), false);
  assert.equal(template.includes('30 天'), false);
  assert.match(script, /保留期/);
  assert.match(template, /保留期/);
});

test('pending-deletion onShow does not call the normal profile endpoint', async () => {
  let profileCalls = 0;
  const storage = new Map([
    ['accountStatus', 'pending_deletion'],
    ['recoveryToken', 'recovery-token'],
    ['deletionDueAt', '2026-08-25T00:00:00Z'],
    ['manualLogout', false],
  ]);
  const harness = loadProfile({
    storage,
    api: {
      getProfile() {
        profileCalls += 1;
        return Promise.resolve({});
      },
    },
  });

  try {
    await harness.page.onShow();
    assert.equal(profileCalls, 0);
    assert.equal(harness.page.data.loggedIn, true);
    assert.equal(harness.page.data.pendingDeletion, true);
    assert.equal(harness.page.data.deletionDueText, '2026-08-25 08:00');
  } finally {
    harness.cleanup();
  }
});

test('restoring a deleted account replaces recovery state and reloads profile', async () => {
  let storedLogin;
  let profileLoads = 0;
  const harness = loadProfile({
    api: {
      recoverDeletedAccount: () => Promise.resolve({
        token: 'new-normal-token',
        account_status: 'active',
      }),
    },
    session: {
      storeLogin(data) { storedLogin = data; },
    },
  });
  harness.page.setData({ loggedIn: true, pendingDeletion: true });
  harness.page.loadProfile = () => {
    profileLoads += 1;
    return Promise.resolve();
  };

  try {
    await harness.page.onRecoverDeletion();
    assert.equal(storedLogin.token, 'new-normal-token');
    assert.equal(profileLoads, 1);
    assert.equal(harness.page.data.pendingDeletion, false);
  } finally {
    harness.cleanup();
  }
});
