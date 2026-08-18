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
  await api.recoverAccount('recovery-token');
  await api.logoutAccount();
  await api.requestAccountDeletion('fresh-login-code');
  await api.recoverDeletedAccount();
  await api.uploadImage('/tmp/a.jpg');
  await api.listQuestions();
  await api.getQuestion('question-id');
  await api.updateQuestion('question-id', {});
  await api.deleteQuestion('question-id');
  await api.createSheet({ question_ids: ['question-id'] });
  await api.listSheets();
  await api.getSheetGeneration('sheet-id');
  await api.retrySheetGeneration('sheet-id');
  await api.deleteSheet('sheet-id');
  await api.getSheetReview('sheet-id');
  await api.listSheetAttempts('sheet-id');
  await api.createSheetAttempt('sheet-id', {});
  await api.updateSheetAttempt('sheet-id', 'attempt-id', {});
  await api.getProfile();
  await api.updateProfile({ grade: 2 });
  await api.skipProfilePrompt();
  await api.uploadAvatar('/tmp/avatar.jpg');

  assert.deepEqual(calls, [
    { method: 'POST', path: '/api/auth/login' },
    { method: 'POST', path: '/api/auth/bind-phone' },
    { method: 'POST', path: '/api/auth/recover-account' },
    { method: 'POST', path: '/api/account/logout' },
    { method: 'POST', path: '/api/account/deletion' },
    { method: 'POST', path: '/api/account/deletion/recover' },
    { method: 'POST', path: '/api/upload/image' },
    { method: 'GET', path: '/api/questions' },
    { method: 'GET', path: '/api/questions/question-id' },
    { method: 'PATCH', path: '/api/questions/question-id' },
    { method: 'DELETE', path: '/api/questions/question-id' },
    { method: 'POST', path: '/api/sheets' },
    { method: 'GET', path: '/api/sheets' },
    { method: 'GET', path: '/api/sheets/sheet-id/generation' },
    { method: 'POST', path: '/api/sheets/sheet-id/retry' },
    { method: 'DELETE', path: '/api/sheets/sheet-id' },
    { method: 'GET', path: '/api/sheets/sheet-id/review' },
    { method: 'GET', path: '/api/sheets/sheet-id/attempts' },
    { method: 'POST', path: '/api/sheets/sheet-id/attempts' },
    { method: 'PATCH', path: '/api/sheets/sheet-id/attempts/attempt-id' },
    { method: 'GET', path: '/api/profile' },
    { method: 'PATCH', path: '/api/profile' },
    { method: 'POST', path: '/api/profile/prompt/skip' },
    { method: 'POST', path: '/api/profile/avatar' },
  ]);
});
