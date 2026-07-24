const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const sessionPath = path.resolve(__dirname, '..', 'utils', 'session.js');

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

  assert.deepEqual(removed, ['token', 'token', 'accountId', 'studentId']);
  assert.equal(relaunched, true);
});
