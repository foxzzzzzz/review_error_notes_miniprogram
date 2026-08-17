const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');

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
    getImageStatuses: () => Promise.resolve([]),
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
    page.startStatusPolling = () => Promise.resolve();
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
    assert.equal(page.data.uploads[0].status, 'pending');
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


function createCapturePage(definition, uploads = []) {
  return {
    ...definition,
    data: { ...definition.data, uploads },
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
}


test('capture applies a batch subject to every current image', () => {
  global.wx = {
    showActionSheet(options) { options.success({ tapIndex: 0 }); },
  };
  const definition = loadCapturePage({});
  const page = createCapturePage(definition, [
    { id: '1', subject: null },
    { id: '2', subject: 'english' },
  ]);

  try {
    page.onBatchSubjectTap();

    assert.equal(page.data.batchSubject, 'math');
    assert.deepEqual(page.data.uploads.map(item => item.subject), ['math', 'math']);
  } finally {
    delete global.wx;
    delete global.Page;
    delete require.cache[capturePath];
    delete require.cache[apiPath];
  }
});


test('capture gives newly selected images the batch subject', () => {
  global.wx = {
    chooseMedia(options) {
      options.success({ tempFiles: [{ tempFilePath: '/tmp/new.jpg' }] });
    },
    setStorageSync() {},
  };
  const definition = loadCapturePage({});
  const page = createCapturePage(definition);
  page.data.batchSubject = 'chinese';

  try {
    page.takePhoto();

    assert.equal(page.data.uploads[0].subject, 'chinese');
  } finally {
    delete global.wx;
    delete global.Page;
    delete require.cache[capturePath];
    delete require.cache[apiPath];
  }
});


test('capture starts a new batch without discarding submitted active jobs', () => {
  const stored = {};
  global.wx = {
    chooseMedia(options) {
      options.success({ tempFiles: [{ tempFilePath: '/tmp/new.jpg' }] });
    },
    setStorageSync(key, value) { stored[key] = value; },
  };
  const definition = loadCapturePage({});
  const page = createCapturePage(definition, [
    { id: 'draft', path: '/tmp/draft.jpg', status: 'pending', subject: 'math' },
    { id: 'submitted', imageId: 'image-1', path: '/tmp/submitted.jpg', status: 'segmented', subject: 'math' },
    { id: 'finished', imageId: 'image-2', path: '/tmp/finished.jpg', status: 'confirmed', subject: 'math' },
  ]);

  try {
    page.takePhoto();

    assert.deepEqual(page.data.uploads.map(item => item.path), ['/tmp/new.jpg']);
    assert.deepEqual(page.data.backgroundUploads.map(item => item.imageId), ['image-1']);
    assert.deepEqual(stored.captureBackgroundUploads.map(item => item.imageId), ['image-1']);
  } finally {
    delete global.wx;
    delete global.Page;
    delete require.cache[capturePath];
    delete require.cache[apiPath];
  }
});


test('capture restores and polls submitted background jobs', async () => {
  const requestedIds = [];
  global.wx = {
    getStorageSync(key) {
      return key === 'captureBackgroundUploads' ? [{
        id: 'submitted', imageId: 'image-1', path: '/tmp/submitted.jpg', status: 'pending', subject: 'math',
      }] : '';
    },
    setStorageSync() {},
  };
  const definition = loadCapturePage({
    getImageStatuses(ids) {
      requestedIds.push(ids);
      return Promise.resolve([{ image_id: 'image-1', status: 'segmented', question_count: 0 }]);
    },
  });
  const page = createCapturePage(definition);

  try {
    page.restoreBackgroundUploads();
    await page.refreshImageStatuses();

    assert.deepEqual(requestedIds, [['image-1']]);
    assert.equal(page.data.backgroundUploads[0].status, 'segmented');
  } finally {
    delete global.wx;
    delete global.Page;
    delete require.cache[capturePath];
    delete require.cache[apiPath];
  }
});


test('capture stores background jobs separately for each student', () => {
  const stored = {};
  global.wx = {
    getStorageSync(key) { return key === 'studentId' ? 'student-a' : ''; },
    setStorageSync(key, value) { stored[key] = value; },
  };
  const definition = loadCapturePage({});
  const page = createCapturePage(definition);
  page.data.backgroundUploads = [{
    id: 'submitted', imageId: 'image-1', status: 'pending', subject: 'math',
  }];

  try {
    page.persistBackgroundUploads();

    assert.deepEqual(stored['captureBackgroundUploads:student-a'].map(item => item.imageId), ['image-1']);
    assert.equal(stored.captureBackgroundUploads, undefined);
  } finally {
    delete global.wx;
    delete global.Page;
    delete require.cache[capturePath];
    delete require.cache[apiPath];
  }
});


test('capture changes the main preview when a thumbnail is selected', () => {
  global.wx = {};
  const definition = loadCapturePage({});
  const page = createCapturePage(definition, [
    { id: 'one', path: '/tmp/one.jpg', status: 'pending' },
    { id: 'two', path: '/tmp/two.jpg', status: 'pending' },
  ]);

  try {
    page.selectPreview({ currentTarget: { dataset: { id: 'two' } } });

    assert.equal(page.data.previewUrl, '/tmp/two.jpg');
    assert.equal(page.data.previewUploadId, 'two');
  } finally {
    delete global.wx;
    delete global.Page;
    delete require.cache[capturePath];
    delete require.cache[apiPath];
  }
});


test('capture template renders clickable thumbnails and background jobs', () => {
  const template = fs.readFileSync(path.resolve(__dirname, '..', 'pages', 'capture', 'capture.wxml'), 'utf8');

  assert.match(template, /bindtap="selectPreview"/);
  assert.match(template, /backgroundUploads/);
});


test('capture expands and collapses the background job list', () => {
  global.wx = {};
  const definition = loadCapturePage({});
  const page = createCapturePage(definition);

  try {
    page.toggleBackgroundUploads();
    assert.equal(page.data.showBackgroundUploads, true);
    page.toggleBackgroundUploads();
    assert.equal(page.data.showBackgroundUploads, false);
  } finally {
    delete global.wx;
    delete global.Page;
    delete require.cache[capturePath];
    delete require.cache[apiPath];
  }
});


test('capture keeps an individual subject override after batch selection', () => {
  global.wx = {
    showActionSheet(options) { options.success({ tapIndex: 2 }); },
  };
  const definition = loadCapturePage({});
  const page = createCapturePage(definition, [{ id: '1', subject: 'math' }]);

  try {
    page.onSubjectTap({ currentTarget: { dataset: { index: 0 } } });

    assert.equal(page.data.uploads[0].subject, 'english');
  } finally {
    delete global.wx;
    delete global.Page;
    delete require.cache[capturePath];
    delete require.cache[apiPath];
  }
});


test('capture refreshes a submitted image with its backend status', async () => {
  global.wx = { setStorageSync() {} };
  const definition = loadCapturePage({
    getImageStatuses: () => Promise.resolve([{
      image_id: 'image-1',
      status: 'needs_review',
      question_count: 2,
      error_code: null,
      error_message: null,
    }]),
  });
  const page = createCapturePage(definition, [{
    id: 'local-1', imageId: 'image-1', status: 'pending', subject: 'math',
  }]);

  try {
    await page.refreshImageStatuses();

    assert.equal(page.data.uploads[0].status, 'needs_review');
    assert.equal(page.data.uploads[0].questionCount, 2);
  } finally {
    delete global.wx;
    delete global.Page;
    delete require.cache[capturePath];
    delete require.cache[apiPath];
  }
});


test('capture retries a failed backend image without uploading it again', async () => {
  let retried = 0;
  global.wx = { showToast() {} };
  const definition = loadCapturePage({
    retryImage: () => {
      retried += 1;
      return Promise.resolve({ image_id: 'image-1', status: 'pending' });
    },
    getImageStatuses: () => Promise.resolve([]),
  });
  const page = createCapturePage(definition, [{
    id: 'local-1', imageId: 'image-1', status: 'failed', subject: 'math',
  }]);
  page.startStatusPolling = () => Promise.resolve();

  try {
    await page.onRetryTap({ currentTarget: { dataset: { index: 0 } } });

    assert.equal(retried, 1);
    assert.equal(page.data.uploads[0].status, 'pending');
  } finally {
    delete global.wx;
    delete global.Page;
    delete require.cache[capturePath];
    delete require.cache[apiPath];
  }
});


test('capture does not schedule polling after the page is hidden during a status request', async () => {
  let resolveStatuses;
  const originalSetTimeout = global.setTimeout;
  const originalClearTimeout = global.clearTimeout;
  const scheduled = [];
  global.setTimeout = callback => {
    scheduled.push(callback);
    return scheduled.length;
  };
  global.clearTimeout = () => {};
  global.wx = {};
  const definition = loadCapturePage({
    getImageStatuses: () => new Promise(resolve => { resolveStatuses = resolve; }),
  });
  const page = createCapturePage(definition, [{
    id: 'local-1', imageId: 'image-1', status: 'pending', subject: 'math',
  }]);

  try {
    const polling = page.startStatusPolling();
    page.onHide();
    resolveStatuses([]);
    await polling;

    assert.equal(scheduled.length, 0);
  } finally {
    global.setTimeout = originalSetTimeout;
    global.clearTimeout = originalClearTimeout;
    delete global.wx;
    delete global.Page;
    delete require.cache[capturePath];
    delete require.cache[apiPath];
  }
});
