const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const appPath = path.resolve(__dirname, '..', 'app.js');
const sessionPath = path.resolve(__dirname, '..', 'utils', 'session.js');


test('first login redirects to profile completion without blocking skip', async () => {
  let definition;
  let destination = '';
  delete require.cache[appPath];
  require.cache[sessionPath] = {
    id: sessionPath,
    filename: sessionPath,
    loaded: true,
    exports: {
      login: () => Promise.resolve({
        account_status: 'active',
        profile_prompt_required: true,
      }),
    },
  };
  global.wx = {
    reLaunch({ url }) { destination = url; },
    showToast() {},
  };
  global.App = value => { definition = value; };
  require(appPath);

  try {
    definition.onLaunch();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(destination, '/pages/profile/profile?prompt=1');
  } finally {
    delete global.wx;
    delete global.App;
    delete require.cache[appPath];
    delete require.cache[sessionPath];
  }
});
