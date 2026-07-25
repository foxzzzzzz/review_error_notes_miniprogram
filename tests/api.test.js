const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');

const { SERVER_BASE } = require('../utils/config');
const apiPath = path.resolve(__dirname, '..', 'utils', 'api.js');
const sessionPath = path.resolve(__dirname, '..', 'utils', 'session.js');

function loadApi(wxOverrides = {}) {
  delete require.cache[apiPath];
  delete require.cache[sessionPath];
  global.wx = {
    getStorageSync: () => 'test-token',
    setStorageSync: () => {},
    removeStorageSync: () => {},
    request: () => {},
    uploadFile: () => {},
    downloadFile: () => {},
    reLaunch: () => {},
    ...wxOverrides,
  };
  return require(apiPath);
}


test('profile methods use the profile endpoint', async () => {
  const calls = [];
  const api = loadApi({
    request(options) {
      calls.push(options);
      options.success({ statusCode: 200, data: { grade: 3, semester: 2 } });
    },
  });

  await api.getProfile();
  await api.updateProfile({ grade: 4, semester: 1 });
  await api.skipProfilePrompt();

  assert.equal(calls[0].url.endsWith('/profile'), true);
  assert.equal(calls[0].method, 'GET');
  assert.equal(calls[1].url.endsWith('/profile'), true);
  assert.equal(calls[1].method, 'PATCH');
  assert.deepEqual(calls[1].data, { grade: 4, semester: 1 });
  assert.equal(calls[2].url.endsWith('/profile/prompt/skip'), true);
  assert.equal(calls[2].method, 'POST');
});


test('avatar upload sends the selected file with authentication', async () => {
  let call;
  const api = loadApi({
    uploadFile(options) {
      call = options;
      options.success({
        statusCode: 200,
        data: JSON.stringify({ avatar_url: '/avatars/account.jpg' }),
      });
    },
  });

  const result = await api.uploadAvatar('/tmp/avatar.png');

  assert.equal(call.url.endsWith('/api/profile/avatar'), true);
  assert.equal(call.filePath, '/tmp/avatar.png');
  assert.equal(call.name, 'file');
  assert.equal(call.header.Authorization, 'Bearer test-token');
  assert.equal(result.avatar_url, '/avatars/account.jpg');
});


test('image upload sends subject and school settings as form data', async () => {
  let call;
  const api = loadApi({
    uploadFile(options) {
      call = options;
      options.success({ statusCode: 200, data: '{"image_id":"image-1","status":"pending"}' });
    },
  });

  await api.uploadImage('/tmp/question.jpg', {
    subject: 'math',
    grade: 4,
    semester: 2,
  });

  assert.deepEqual(call.formData, { subject: 'math', grade: 4, semester: 2 });
});


test('capture page does not submit an empty optional subject', () => {
  const source = fs.readFileSync(
    path.resolve(__dirname, '..', 'pages', 'capture', 'capture.js'),
    'utf8'
  );

  assert.equal(source.includes("subject: uploads[idx].subject || ''"), false);
});


test('question detail method requests one question by id', async () => {
  let call;
  const api = loadApi({
    request(options) {
      call = options;
      options.success({ statusCode: 200, data: { id: 'question-7' } });
    },
  });

  const result = await api.getQuestion('question-7');

  assert.equal(call.url.endsWith('/questions/question-7'), true);
  assert.equal(call.method, 'GET');
  assert.equal(result.id, 'question-7');
});


test('server URL resolver expands relative file paths', () => {
  const api = loadApi();

  assert.equal(api.resolveServerUrl('/uploads/a.jpg'), SERVER_BASE + '/uploads/a.jpg');
  assert.equal(api.resolveServerUrl('https://cdn.example/a.jpg'), 'https://cdn.example/a.jpg');
  assert.equal(api.resolveServerUrl(''), '');
});


test('question image download sends authentication and returns the temporary path', async () => {
  let call;
  const api = loadApi({
    downloadFile(options) {
      call = options;
      options.success({ statusCode: 200, tempFilePath: 'wxfile://question.jpg' });
    },
  });

  const result = await api.downloadQuestionImage('question-7', 'original');

  assert.equal(call.url.endsWith('/api/questions/question-7/image?view=original'), true);
  assert.equal(call.header.Authorization, 'Bearer test-token');
  assert.equal(result, 'wxfile://question.jpg');
});


test('question image download rejects non-2xx responses', async () => {
  const api = loadApi({
    downloadFile(options) {
      options.success({ statusCode: 422 });
    },
  });

  await assert.rejects(api.downloadQuestionImage('question-7'), error => {
    assert.equal(error.name, 'ApiError');
    assert.equal(error.statusCode, 422);
    assert.equal(error.message, '图片加载失败 (422)');
    return true;
  });
});


test('question image download rejects a missing temporary path', async () => {
  const api = loadApi({
    downloadFile(options) {
      options.success({ statusCode: 200 });
    },
  });

  await assert.rejects(api.downloadQuestionImage('question-7'), error => {
    assert.equal(error.name, 'ApiError');
    assert.equal(error.statusCode, 200);
    return true;
  });
});


test('question image download retries once after an expired login', async () => {
  const removed = [];
  let downloads = 0;
  let loginRequests = 0;
  let relaunched = false;
  const api = loadApi({
    removeStorageSync(key) { removed.push(key); },
    reLaunch() { relaunched = true; },
    request(options) {
      loginRequests += 1;
      options.success({
        statusCode: 200,
        data: {
          token: 'renewed',
          account_id: 'account-1',
          student_id: 'student-1',
        },
      });
    },
    downloadFile(options) {
      downloads += 1;
      options.success(
        downloads === 1
          ? { statusCode: 401 }
          : { statusCode: 200, tempFilePath: 'wxfile://retried.jpg' }
      );
    },
  });

  const result = await api.downloadQuestionImage('question-7');

  assert.equal(result, 'wxfile://retried.jpg');
  assert.equal(downloads, 2);
  assert.equal(loginRequests, 1);
  assert.deepEqual(removed, ['token']);
  assert.equal(relaunched, false);
});


test('phone binding submits the one-time WeChat code', async () => {
  let call;
  const api = loadApi({
    request(options) {
      call = options;
      options.success({ statusCode: 200, data: { ok: true } });
    },
  });

  await api.bindPhone('phone-code');

  assert.equal(call.url.endsWith('/auth/bind-phone'), true);
  assert.equal(call.method, 'POST');
  assert.deepEqual(call.data, { code: 'phone-code' });
});


test('phone binding remains a future action instead of requesting authorization', () => {
  const source = fs.readFileSync(
    path.resolve(__dirname, '..', 'pages', 'profile', 'profile.wxml'),
    'utf8'
  );

  assert.equal(source.includes('open-type="getPhoneNumber"'), false);
  assert.equal(source.includes('后续开放'), true);
});


for (const statusCode of [400, 500]) {
  test(`request rejects HTTP ${statusCode} with an ApiError`, async () => {
    const api = loadApi({
      request(options) {
        options.success({ statusCode, data: { detail: 'request failed' } });
      },
    });

    await assert.rejects(api.listSheets(), error => {
      assert.equal(error.name, 'ApiError');
      assert.equal(error.statusCode, statusCode);
      assert.equal(error.message, 'request failed');
      return true;
    });
  });
}


test('request retries once after 401 with a renewed session', async () => {
  const removed = [];
  let businessRequests = 0;
  let loginRequests = 0;
  let relaunched = false;
  const api = loadApi({
    removeStorageSync(key) { removed.push(key); },
    reLaunch() { relaunched = true; },
    request(options) {
      if (options.url.endsWith('/auth/dev-login')) {
        loginRequests += 1;
        options.success({
          statusCode: 200,
          data: {
            token: 'renewed',
            account_id: 'account-1',
            student_id: 'student-1',
          },
        });
        return;
      }
      businessRequests += 1;
      options.success(
        businessRequests === 1
          ? { statusCode: 401, data: { detail: 'expired' } }
          : { statusCode: 200, data: [] }
      );
    },
  });

  assert.deepEqual(await api.listSheets(), []);
  assert.equal(businessRequests, 2);
  assert.equal(loginRequests, 1);
  assert.deepEqual(removed, ['token']);
  assert.equal(relaunched, false);
});


test('upload rejects non-2xx responses', async () => {
  const api = loadApi({
    uploadFile(options) {
      options.success({ statusCode: 422, data: '{"detail":"invalid upload"}' });
    },
  });

  await assert.rejects(api.uploadImage('/tmp/a.jpg'), error => {
    assert.equal(error.name, 'ApiError');
    assert.equal(error.statusCode, 422);
    assert.equal(error.message, 'invalid upload');
    return true;
  });
});


test('upload retries a bodyless 401 after renewing the session', async () => {
  let uploads = 0;
  let loginRequests = 0;
  const api = loadApi({
    request(options) {
      loginRequests += 1;
      options.success({
        statusCode: 200,
        data: {
          token: 'renewed',
          account_id: 'account-1',
          student_id: 'student-1',
        },
      });
    },
    uploadFile(options) {
      uploads += 1;
      options.success(
        uploads === 1
          ? { statusCode: 401, data: '' }
          : { statusCode: 200, data: '{"image_id":"image-1"}' }
      );
    },
  });

  assert.deepEqual(await api.uploadImage('/tmp/a.jpg'), { image_id: 'image-1' });
  assert.equal(uploads, 2);
  assert.equal(loginRequests, 1);
});


test('upload rejects malformed JSON as an ApiError', async () => {
  const api = loadApi({
    uploadFile(options) {
      options.success({ statusCode: 200, data: 'not-json' });
    },
  });

  await assert.rejects(api.uploadImage('/tmp/a.jpg'), error => {
    assert.equal(error.name, 'ApiError');
    assert.equal(error.message, '服务器返回了无效数据');
    return true;
  });
});
