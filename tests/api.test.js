const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');


const apiPath = path.resolve(__dirname, '..', 'utils', 'api.js');

function loadApi(wxOverrides = {}) {
  delete require.cache[apiPath];
  global.wx = {
    getStorageSync: () => 'test-token',
    request: () => {},
    uploadFile: () => {},
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

  assert.equal(calls[0].url.endsWith('/profile'), true);
  assert.equal(calls[0].method, 'GET');
  assert.equal(calls[1].url.endsWith('/profile'), true);
  assert.equal(calls[1].method, 'PATCH');
  assert.deepEqual(calls[1].data, { grade: 4, semester: 1 });
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
