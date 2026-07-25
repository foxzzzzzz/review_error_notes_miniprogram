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
    'token',
    'accountId',
    'studentId',
    'profilePromptRequired',
    'studentProfileRequired',
    'accountStatus',
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
      uploadAvatar: () => Promise.resolve(profile),
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

test('profile page delegates manual logout to the session module', () => {
  let logoutOptions;
  const definition = loadProfilePage({
    profile: {},
    logoutLocal: options => { logoutOptions = options; },
  });

  try {
    definition.onLogout();
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
      stats: { total: 8, month_new: 3, needs_review: 6, mastered: 2 },
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
    assert.equal(page.data.avatarUrl, '/avatars/a.jpg');
    assert.deepEqual(page.data.stats, {
      total: 8,
      monthNew: 3,
      needsReview: 6,
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
      ['needsReview', { label: '待复习', status: 'needs_review' }],
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
