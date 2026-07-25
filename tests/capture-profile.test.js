const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const capturePath = path.resolve(__dirname, '..', 'pages', 'capture', 'capture.js');
const apiPath = path.resolve(__dirname, '..', 'utils', 'api.js');


function loadCapturePage(apiOverrides) {
  let definition;
  delete require.cache[capturePath];
  require.cache[apiPath] = {
    id: apiPath,
    filename: apiPath,
    loaded: true,
    exports: apiOverrides,
  };
  global.Page = value => { definition = value; };
  require(capturePath);
  return definition;
}


test('capture blocks upload until student settings are saved, then resumes once', async () => {
  let uploads = 0;
  let profileUpdates = 0;
  global.wx = {
    getStorageSync(key) { return key === 'token' ? 'token' : ''; },
    setStorageSync() {},
    showToast() {},
  };
  const definition = loadCapturePage({
    getProfile: () => Promise.resolve({
      grade: null,
      semester: null,
      student_profile_required: true,
    }),
    updateProfile: data => {
      profileUpdates += 1;
      return Promise.resolve({
        grade: data.grade,
        semester: data.semester,
        student_profile_required: false,
      });
    },
    uploadImage: () => {
      uploads += 1;
      return Promise.resolve({ image_id: 'image-1' });
    },
  });
  const page = {
    ...definition,
    data: {
      ...definition.data,
      uploads: [{ id: '1', path: '/tmp/a.jpg', status: 'pending', subject: null }],
    },
    setData(values) {
      for (const [key, value] of Object.entries(values)) {
        const match = key.match(/^uploads\[(\d+)\]\.(.+)$/);
        if (match) {
          this.data.uploads[Number(match[1])][match[2]] = value;
        } else {
          this.data[key] = value;
        }
      }
    },
  };

  try {
    await page.onShow();
    await page.submitAll();
    assert.equal(uploads, 0);
    assert.equal(page.data.showStudentSettings, true);
    assert.equal(page.data.resumeSubmitAfterSettings, true);

    page.onSettingsGradeChange({ detail: { value: '1' } });
    page.onSettingsSemesterChange({ detail: { value: '0' } });
    await page.onSaveStudentSettings();

    assert.equal(profileUpdates, 1);
    assert.equal(uploads, 1);
    assert.equal(page.data.uploads[0].status, 'confirmed');
    assert.equal(page.data.resumeSubmitAfterSettings, false);
  } finally {
    delete global.wx;
    delete global.Page;
    delete require.cache[capturePath];
    delete require.cache[apiPath];
  }
});


test('capture keeps selected settings and does not upload when settings save fails', async () => {
  let uploads = 0;
  global.wx = {
    getStorageSync: () => 'token',
    setStorageSync() {},
    showToast() {},
  };
  const definition = loadCapturePage({
    getProfile: () => Promise.resolve({ grade: null, semester: null }),
    updateProfile: () => Promise.reject(new Error('save failed')),
    uploadImage: () => {
      uploads += 1;
      return Promise.resolve({});
    },
  });
  const page = {
    ...definition,
    data: {
      ...definition.data,
      uploads: [{ id: '1', path: '/tmp/a.jpg', status: 'pending', subject: null }],
      showStudentSettings: true,
      resumeSubmitAfterSettings: true,
      settingsGradeIndex: 3,
      settingsSemester: 1,
    },
    setData(values) { Object.assign(this.data, values); },
  };

  try {
    await page.onSaveStudentSettings();
    assert.equal(uploads, 0);
    assert.equal(page.data.showStudentSettings, true);
    assert.equal(page.data.resumeSubmitAfterSettings, true);
    assert.equal(page.data.settingsGradeIndex, 3);
    assert.equal(page.data.settingsSemester, 1);
  } finally {
    delete global.wx;
    delete global.Page;
    delete require.cache[capturePath];
    delete require.cache[apiPath];
  }
});
