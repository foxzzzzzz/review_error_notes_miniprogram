const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const sessionPath = path.resolve(__dirname, '..', 'utils', 'session.js');
const apiPath = path.resolve(__dirname, '..', 'utils', 'api.js');
const profilePath = path.resolve(__dirname, '..', 'pages', 'profile', 'profile.js');

function loadSession(wxOverrides = {}) {
  delete require.cache[sessionPath];
  const storage = new Map();
  global.wx = {
    getStorageSync(key) { return storage.get(key); },
    setStorageSync(key, value) { storage.set(key, value); },
    removeStorageSync(key) { storage.delete(key); },
    request() {},
    login() {},
    reLaunch() {},
    ...wxOverrides,
  };
  return { session: require(sessionPath), storage };
}

test('development login uses one stable configured identity and stores account context', async () => {
  const calls = [];
  const { session, storage } = loadSession({
    request(options) {
      calls.push(options);
      options.success({
        statusCode: 200,
        data: {
          token: 'token-1',
          account_id: 'account-1',
          student_id: 'student-1',
          profile_prompt_required: true,
          student_profile_required: true,
          account_status: 'active',
        },
      });
    },
  });

  await session.login();

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url.endsWith('/auth/dev-login'), true);
  assert.deepEqual(calls[0].data, { code: 'dev-local-account' });
  assert.equal(storage.get('token'), 'token-1');
  assert.equal(storage.get('accountId'), 'account-1');
  assert.equal(storage.get('studentId'), 'student-1');
  assert.equal(storage.get('manualLogout'), false);
  assert.equal(storage.get('profilePromptRequired'), true);
  assert.equal(storage.get('studentProfileRequired'), true);
  assert.equal(storage.get('accountStatus'), 'active');
});

test('manual logout suppresses automatic login until login is forced', async () => {
  let requests = 0;
  const { session, storage } = loadSession({
    request(options) {
      requests += 1;
      options.success({
        statusCode: 200,
        data: {
          token: 'token-2',
          account_id: 'account-2',
          student_id: 'student-2',
        },
      });
    },
  });
  storage.set('manualLogout', true);

  const skipped = await session.login();
  assert.equal(skipped, null);
  assert.equal(requests, 0);

  await session.login({ force: true });
  assert.equal(requests, 1);
  assert.equal(storage.get('manualLogout'), false);
});

test('pending-deletion login stores only the recovery session', async () => {
  let requests = 0;
  const { session, storage } = loadSession({
    request(options) {
      requests += 1;
      options.success({
        statusCode: 200,
        data: {
          token: null,
          recovery_token: 'recovery-token',
          account_id: 'account-pending',
          student_id: 'student-pending',
          account_status: 'pending_deletion',
          deletion_due_at: '2026-08-25T00:00:00Z',
        },
      });
    },
  });

  const first = await session.login();
  const cached = await session.login();

  assert.equal(requests, 1);
  assert.equal(first.recovery_token, 'recovery-token');
  assert.equal(cached.recovery_token, 'recovery-token');
  assert.equal(storage.has('token'), false);
  assert.equal(storage.get('recoveryToken'), 'recovery-token');
  assert.equal(storage.get('accountStatus'), 'pending_deletion');
  assert.equal(storage.get('deletionDueAt'), '2026-08-25T00:00:00Z');
});

test('restoring an active login clears recovery-only state', () => {
  const { session, storage } = loadSession();
  storage.set('recoveryToken', 'old-recovery-token');
  storage.set('deletionDueAt', '2026-08-25T00:00:00Z');

  session.storeLogin({
    token: 'normal-token',
    account_id: 'account-active',
    student_id: 'student-active',
    account_status: 'active',
  });

  assert.equal(storage.get('token'), 'normal-token');
  assert.equal(storage.has('recoveryToken'), false);
  assert.equal(storage.has('deletionDueAt'), false);
  assert.equal(storage.get('accountStatus'), 'active');
});

test('fresh identity verification always invokes wx.login in development', async () => {
  let loginCalls = 0;
  const { session } = loadSession({
    login(options) {
      loginCalls += 1;
      options.success({ code: 'temporary-wechat-code' });
    },
  });

  const code = await session.getFreshLoginCode();

  assert.equal(loginCalls, 1);
  assert.equal(code, 'dev-local-account');
});

test('unauthorized retry preserves a pending-deletion recovery session', async () => {
  let retries = 0;
  let destination = '';
  const { session, storage } = loadSession({
    request(options) {
      options.success({
        statusCode: 200,
        data: {
          token: null,
          recovery_token: 'pending-recovery-token',
          account_id: 'pending-account',
          student_id: 'pending-student',
          account_status: 'pending_deletion',
          deletion_due_at: '2026-08-25T00:00:00Z',
        },
      });
    },
    reLaunch({ url }) { destination = url; },
  });

  await assert.rejects(
    session.retryAfterUnauthorized(() => {
      retries += 1;
      return Promise.resolve();
    }),
    error => error.code === 'account_pending_deletion'
  );

  assert.equal(retries, 0);
  assert.equal(storage.get('recoveryToken'), 'pending-recovery-token');
  assert.equal(storage.get('accountStatus'), 'pending_deletion');
  assert.equal(storage.get('manualLogout'), false);
  assert.equal(destination, '/pages/profile/profile');
});

test('unauthorized retry does not bypass a manual logout', async () => {
  let loginRequests = 0;
  let retries = 0;
  let relaunched = false;
  const { session, storage } = loadSession({
    request(options) {
      loginRequests += 1;
      options.success({
        statusCode: 200,
        data: {
          token: 'renewed-token',
          account_id: 'account-1',
          student_id: 'student-1',
        },
      });
    },
    reLaunch() { relaunched = true; },
  });
  storage.set('manualLogout', true);

  await assert.rejects(
    session.retryAfterUnauthorized(() => {
      retries += 1;
      return Promise.resolve();
    }),
    /manual logout/
  );

  assert.equal(loginRequests, 0);
  assert.equal(retries, 0);
  assert.equal(relaunched, false);
  assert.equal(storage.get('manualLogout'), true);
});

test('simultaneous unauthorized retries share one login flight', async () => {
  let loginRequests = 0;
  const { session } = loadSession({
    request(options) {
      loginRequests += 1;
      setImmediate(() => options.success({
        statusCode: 200,
        data: {
          token: 'renewed-token',
          account_id: 'account-1',
          student_id: 'student-1',
        },
      }));
    },
  });
  let retries = 0;

  const [first, second] = await Promise.all([
    session.retryAfterUnauthorized(() => {
      retries += 1;
      return 'first';
    }),
    session.retryAfterUnauthorized(() => {
      retries += 1;
      return 'second';
    }),
  ]);

  assert.equal(loginRequests, 1);
  assert.equal(retries, 2);
  assert.deepEqual([first, second], ['first', 'second']);
});

test('failed retry clears all local account context and redirects', async () => {
  const removed = [];
  let relaunched = false;
  const { session } = loadSession({
    removeStorageSync(key) { removed.push(key); },
    reLaunch() { relaunched = true; },
    request(options) {
      options.success({
        statusCode: 200,
        data: {
          token: 'renewed-token',
          account_id: 'account-1',
          student_id: 'student-1',
        },
      });
    },
  });

  await assert.rejects(
    session.retryAfterUnauthorized(() => Promise.reject(new Error('still unauthorized'))),
    /still unauthorized/
  );

  assert.deepEqual(removed, [
    'token',
    'recoveryToken',
    'deletionDueAt',
    'token',
    'recoveryToken',
    'accountId',
    'studentId',
    'profilePromptRequired',
    'studentProfileRequired',
    'accountStatus',
    'deletionDueAt',
  ]);
  assert.equal(relaunched, true);
});

function loadProfilePage({ profile = {}, logoutLocal = () => {}, apiOverrides = {} }) {
  let definition;
  delete require.cache[profilePath];
  require.cache[apiPath] = {
    id: apiPath,
    filename: apiPath,
    loaded: true,
    exports: {
      getProfile: () => Promise.resolve(profile),
      updateProfile: () => Promise.resolve(),
      skipProfilePrompt: () => Promise.resolve(profile),
      logoutAccount: () => Promise.resolve({ ok: true }),
      uploadAvatar: () => Promise.resolve(profile),
      downloadAvatar: () => Promise.resolve('wxfile://avatar.jpg'),
      resolveServerUrl: value => value,
      ...apiOverrides,
    },
  };
  require.cache[sessionPath] = {
    id: sessionPath,
    filename: sessionPath,
    loaded: true,
    exports: { logoutLocal },
  };
  global.Page = value => { definition = value; };
  require(profilePath);
  return definition;
}

test('profile page audits logout before clearing the local session', async () => {
  let auditCalls = 0;
  let logoutOptions;
  const definition = loadProfilePage({
    profile: {},
    logoutLocal: options => { logoutOptions = options; },
    apiOverrides: {
      logoutAccount() {
        auditCalls += 1;
        return Promise.resolve({ ok: true });
      },
    },
  });

  try {
    await definition.onLogout();
    assert.equal(auditCalls, 1);
    assert.deepEqual(logoutOptions, { manual: true, redirect: true });
  } finally {
    delete global.Page;
    delete require.cache[profilePath];
    delete require.cache[apiPath];
    delete require.cache[sessionPath];
  }
});

test('profile page clears the local session when logout audit fails', async () => {
  let logoutOptions;
  const definition = loadProfilePage({
    profile: {},
    logoutLocal: options => { logoutOptions = options; },
    apiOverrides: {
      logoutAccount: () => Promise.reject(new Error('offline')),
    },
  });

  try {
    await definition.onLogout();
    assert.deepEqual(logoutOptions, { manual: true, redirect: true });
  } finally {
    delete global.Page;
    delete require.cache[profilePath];
    delete require.cache[apiPath];
    delete require.cache[sessionPath];
  }
});

test('profile page does not store negative picker indexes for unset settings', async () => {
  const storage = new Map([['grade', 2], ['semester', 1]]);
  global.wx = {
    getStorageSync: key => storage.get(key),
    setStorageSync: (key, value) => storage.set(key, value),
    showToast() {},
  };
  const definition = loadProfilePage({
    profile: {
      nickname: null,
      grade: null,
      semester: null,
      phone_bound: false,
      phone_masked: '',
    },
    logoutLocal() {},
  });
  const page = {
    ...definition,
    data: { ...definition.data },
    setData(values) { Object.assign(this.data, values); },
  };

  try {
    await page.loadProfile();
    assert.equal(page.data.gradeIndex, 2);
    assert.equal(page.data.semester, 1);
    assert.equal(storage.get('grade'), 2);
    assert.equal(storage.get('semester'), 1);
  } finally {
    delete global.wx;
    delete global.Page;
    delete require.cache[profilePath];
    delete require.cache[apiPath];
    delete require.cache[sessionPath];
  }
});

test('profile page stays logged out without calling a protected endpoint after manual logout', async () => {
  let profileRequests = 0;
  global.wx = {
    getStorageSync(key) {
      if (key === 'manualLogout') return true;
      return '';
    },
    setStorageSync() {},
    showToast() {},
  };
  const definition = loadProfilePage({
    apiOverrides: {
      getProfile() {
        profileRequests += 1;
        return Promise.resolve({});
      },
    },
  });
  const page = {
    ...definition,
    data: { ...definition.data },
    setData(values) { Object.assign(this.data, values); },
  };

  try {
    await page.onShow();
    assert.equal(profileRequests, 0);
    assert.equal(page.data.loggedIn, false);
  } finally {
    delete global.wx;
    delete global.Page;
    delete require.cache[profilePath];
    delete require.cache[apiPath];
    delete require.cache[sessionPath];
  }
});

test('profile page maps backend profile prompt and statistics', async () => {
  const avatarDownloads = [];
  global.wx = {
    getStorageSync(key) {
      if (key === 'token') return 'token';
      return '';
    },
    setStorageSync() {},
    showToast() {},
  };
  const definition = loadProfilePage({
    profile: {
      nickname: '小明',
      avatar_url: '/avatars/a.jpg',
      profile_prompt_required: true,
      student_name: '一年级学生',
      grade: 1,
      semester: 1,
      student_profile_required: false,
      phone_bound: false,
      phone_masked: '',
      stats: { total: 8, month_new: 3, learning: 6, mastered: 2 },
    },
    apiOverrides: {
      downloadAvatar(path) {
        avatarDownloads.push(path);
        return Promise.resolve('wxfile://downloaded-avatar.jpg');
      },
    },
  });
  const page = {
    ...definition,
    data: { ...definition.data },
    setData(values) { Object.assign(this.data, values); },
  };

  try {
    await page.onShow();
    assert.equal(page.data.loggedIn, true);
    assert.equal(page.data.showProfilePrompt, true);
    assert.deepEqual(avatarDownloads, ['/avatars/a.jpg']);
    assert.equal(page.data.avatarUrl, 'wxfile://downloaded-avatar.jpg');
    assert.deepEqual(page.data.stats, {
      total: 8,
      monthNew: 3,
      learning: 6,
      mastered: 2,
    });
  } finally {
    delete global.wx;
    delete global.Page;
    delete require.cache[profilePath];
    delete require.cache[apiPath];
    delete require.cache[sessionPath];
  }
});

test('profile page falls back to the nickname initial when avatar download fails', async () => {
  global.wx = {
    getStorageSync(key) {
      if (key === 'token') return 'token';
      return '';
    },
    setStorageSync() {},
    showToast() {},
  };
  const definition = loadProfilePage({
    profile: {
      nickname: '小明',
      avatar_url: '/avatars/missing.jpg',
      profile_prompt_required: false,
      grade: 1,
      semester: 1,
      student_profile_required: false,
      phone_bound: false,
      stats: {},
    },
    apiOverrides: {
      downloadAvatar: () => Promise.reject(new Error('download failed')),
    },
  });
  const page = {
    ...definition,
    data: { ...definition.data },
    setData(values) { Object.assign(this.data, values); },
  };

  try {
    await page.onShow();
    assert.equal(page.data.avatarUrl, '');
    assert.equal(page.data.avatarTempPath, '');
    assert.equal(page.data.avatarInitial, '小');
  } finally {
    delete global.wx;
    delete global.Page;
    delete require.cache[profilePath];
    delete require.cache[apiPath];
    delete require.cache[sessionPath];
  }
});

test('profile page does not download an avatar when the profile has none', async () => {
  let downloads = 0;
  global.wx = {
    getStorageSync(key) {
      if (key === 'token') return 'token';
      return '';
    },
    setStorageSync() {},
    showToast() {},
  };
  const definition = loadProfilePage({
    profile: {
      nickname: '小明',
      avatar_url: null,
      profile_prompt_required: false,
      grade: 1,
      semester: 1,
      student_profile_required: false,
      phone_bound: false,
      stats: {},
    },
    apiOverrides: {
      downloadAvatar() {
        downloads += 1;
        return Promise.resolve('wxfile://unexpected.jpg');
      },
    },
  });
  const page = {
    ...definition,
    data: { ...definition.data },
    setData(values) { Object.assign(this.data, values); },
  };

  try {
    await page.onShow();
    assert.equal(downloads, 0);
    assert.equal(page.data.avatarUrl, '');
    assert.equal(page.data.avatarInitial, '小');
  } finally {
    delete global.wx;
    delete global.Page;
    delete require.cache[profilePath];
    delete require.cache[apiPath];
    delete require.cache[sessionPath];
  }
});

test('profile statistics navigate to matching question filters', () => {
  const storage = new Map();
  let destination = '';
  global.wx = {
    getStorageSync: () => '',
    setStorageSync: (key, value) => storage.set(key, value),
    switchTab({ url }) { destination = url; },
  };
  const definition = loadProfilePage({});

  try {
    const cases = [
      ['total', { label: '全部错题' }],
      ['learning', { label: '待复习', mastery_status: 'learning' }],
      ['mastered', { label: '已掌握', mastery_status: 'mastered' }],
    ];
    for (const [filter, expected] of cases) {
      definition.onStatTap({ currentTarget: { dataset: { filter } } });
      assert.deepEqual(storage.get('questionEntryFilter'), expected);
    }
    definition.onStatTap({ currentTarget: { dataset: { filter: 'month' } } });
    const monthFilter = storage.get('questionEntryFilter');
    assert.equal(monthFilter.label, '本月新增');
    assert.match(monthFilter.created_from, /^\d{4}-\d{2}-01T00:00:00\+08:00$/);
    assert.equal(destination, '/pages/questions/questions');
  } finally {
    delete global.wx;
    delete global.Page;
    delete require.cache[profilePath];
    delete require.cache[apiPath];
    delete require.cache[sessionPath];
  }
});

test('profile prompt skip is persisted once and closes the editor', async () => {
  let skips = 0;
  global.wx = {
    getStorageSync: () => '',
    setStorageSync() {},
    showToast() {},
  };
  const profile = {
    nickname: null,
    profile_prompt_required: false,
    stats: {},
  };
  const definition = loadProfilePage({
    apiOverrides: {
      skipProfilePrompt() {
        skips += 1;
        return Promise.resolve(profile);
      },
    },
  });
  const page = {
    ...definition,
    data: { ...definition.data, showProfilePrompt: true },
    setData(values) { Object.assign(this.data, values); },
  };

  try {
    await page.onSkipProfile();
    assert.equal(skips, 1);
    assert.equal(page.data.showProfilePrompt, false);
  } finally {
    delete global.wx;
    delete global.Page;
    delete require.cache[profilePath];
    delete require.cache[apiPath];
    delete require.cache[sessionPath];
  }
});

test('profile save failure keeps the nickname draft for retry', async () => {
  global.wx = {
    getStorageSync: () => '',
    setStorageSync() {},
    showToast() {},
  };
  const definition = loadProfilePage({
    apiOverrides: {
      uploadAvatar: () => Promise.resolve({
        nickname: null,
        avatar_url: '/avatars/a.jpg',
        profile_prompt_required: true,
        stats: {},
      }),
      updateProfile: () => Promise.reject(new Error('save failed')),
    },
  });
  const page = {
    ...definition,
    data: {
      ...definition.data,
      nicknameDraft: '小雨',
      avatarTempPath: '/tmp/avatar.jpg',
      showProfilePrompt: true,
    },
    setData(values) { Object.assign(this.data, values); },
  };

  try {
    await page.onSaveProfile();
    assert.equal(page.data.nicknameDraft, '小雨');
    assert.equal(page.data.showProfilePrompt, true);
  } finally {
    delete global.wx;
    delete global.Page;
    delete require.cache[profilePath];
    delete require.cache[apiPath];
    delete require.cache[sessionPath];
  }
});

test('profile save ignores repeated taps while a save is in progress', async () => {
  let resolveUpdate;
  let updates = 0;
  global.wx = {
    getStorageSync: () => '',
    setStorageSync() {},
    showToast() {},
  };
  const definition = loadProfilePage({
    apiOverrides: {
      updateProfile() {
        updates += 1;
        return new Promise(resolve => { resolveUpdate = resolve; });
      },
    },
  });
  const page = {
    ...definition,
    data: {
      ...definition.data,
      nicknameDraft: '小雨',
    },
    setData(values) { Object.assign(this.data, values); },
  };

  try {
    const firstSave = page.onSaveProfile();
    const secondSave = page.onSaveProfile();
    await Promise.resolve();

    assert.equal(updates, 1);
    assert.equal(page.data.loading, true);

    resolveUpdate({
      nickname: '小雨',
      profile_prompt_required: false,
      stats: {},
    });
    await Promise.all([firstSave, secondSave]);

    const template = fs.readFileSync(
      path.resolve(__dirname, '..', 'pages', 'profile', 'profile.wxml'),
      'utf8'
    );
    assert.match(
      template,
      /disabled="\{\{loading\}\}"[^>]*bindtap="onSaveProfile"/
    );
  } finally {
    delete global.wx;
    delete global.Page;
    delete require.cache[profilePath];
    delete require.cache[apiPath];
    delete require.cache[sessionPath];
  }
});
