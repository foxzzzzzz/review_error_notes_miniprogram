const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');


const apiPath = path.resolve(__dirname, '..', 'utils', 'api.js');


test('API wrapper exposes the complete backend route contract', async () => {
  const calls = [];
  delete require.cache[apiPath];
  global.wx = {
    getStorageSync: () => 'token',
    request(options) {
      calls.push({ method: options.method, path: new URL(options.url).pathname });
      options.success({ statusCode: 200, data: {} });
    },
    uploadFile(options) {
      calls.push({ method: 'POST', path: new URL(options.url).pathname });
      options.success({ statusCode: 200, data: '{}' });
    },
  };
  const api = require(apiPath);

  await api.login('login-code');
  await api.bindPhone('phone-code');
  await api.uploadImage('/tmp/a.jpg');
  await api.listQuestions();
  await api.getQuestion('question-id');
  await api.updateQuestion('question-id', {});
  await api.deleteQuestion('question-id');
  await api.createSheet({ question_ids: ['question-id'] });
  await api.listSheets();
  await api.getProfile();
  await api.updateProfile({ grade: 2 });

  assert.deepEqual(calls, [
    { method: 'POST', path: '/api/auth/login' },
    { method: 'POST', path: '/api/auth/bind-phone' },
    { method: 'POST', path: '/api/upload/image' },
    { method: 'GET', path: '/api/questions' },
    { method: 'GET', path: '/api/questions/question-id' },
    { method: 'PATCH', path: '/api/questions/question-id' },
    { method: 'DELETE', path: '/api/questions/question-id' },
    { method: 'POST', path: '/api/sheets' },
    { method: 'GET', path: '/api/sheets' },
    { method: 'GET', path: '/api/profile' },
    { method: 'PATCH', path: '/api/profile' },
  ]);
});
