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

test('capture removes a confirmed background image after returning from review', async () => {
  const requestedIds = [];
  global.wx = {
    getStorageSync(key) { return key === 'token' ? 'token' : ''; },
    setStorageSync() {},
    showToast() {},
  };
  const definition = loadCapturePage({
    getProfile: () => Promise.resolve({ grade: 1, semester: 1 }),
    getImageStatuses(ids) {
      requestedIds.push(ids);
      return Promise.resolve([{ image_id: 'image-1', status: 'confirmed' }]);
    },
  });
  const page = createCapturePage(definition);
  page.data.backgroundUploads = [{
    id: 'submitted', imageId: 'image-1', status: 'needs_review', subject: 'math',
  }];

  try {
    await page.onShow();

    assert.deepEqual(requestedIds, [['image-1']]);
    assert.deepEqual(page.data.backgroundUploads, []);
  } finally {
    delete global.wx;
    delete global.Page;
    delete require.cache[capturePath];
    delete require.cache[apiPath];
  }
});

test('capture keeps a background image that still needs review after returning', async () => {
  const requestedIds = [];
  global.wx = {
    getStorageSync(key) { return key === 'token' ? 'token' : ''; },
    setStorageSync() {},
    showToast() {},
  };
  const definition = loadCapturePage({
    getProfile: () => Promise.resolve({ grade: 1, semester: 1 }),
    getImageStatuses(ids) {
      requestedIds.push(ids);
      return Promise.resolve([{ image_id: 'image-1', status: 'needs_review' }]);
    },
  });
  const page = createCapturePage(definition);
  page.data.backgroundUploads = [{
    id: 'submitted', imageId: 'image-1', status: 'needs_review', subject: 'math',
  }];

  try {
    await page.onShow();

    assert.deepEqual(requestedIds, [['image-1']]);
    assert.equal(page.data.backgroundUploads.length, 1);
    assert.equal(page.data.backgroundUploads[0].status, 'needs_review');
  } finally {
    delete global.wx;
    delete global.Page;
    delete require.cache[capturePath];
    delete require.cache[apiPath];
  }
});

test('capture renders the review action as a no-wrap inline status action', () => {
  const template = fs.readFileSync(path.resolve(__dirname, '..', 'pages', 'capture', 'capture.wxml'), 'utf8');
  const styles = fs.readFileSync(path.resolve(__dirname, '..', 'pages', 'capture', 'capture.wxss'), 'utf8');

  assert.match(template, /class="status-action"[\s\S]*去确认/);
  assert.match(styles, /\.review-btn\s*\{[\s\S]*white-space:\s*nowrap/);
});

test('capture polls more than nine active images in API-sized batches', async () => {
  const requestedIds = [];
  global.wx = { setStorageSync() {} };
  const definition = loadCapturePage({
    getImageStatuses(ids) {
      requestedIds.push(ids);
      return Promise.resolve(ids.map(image_id => ({ image_id, status: 'segmented' })));
    },
  });
  const uploads = Array.from({ length: 10 }, (_, index) => ({
    id: `local-${index}`, imageId: `image-${index}`, status: 'pending', subject: 'math',
  }));
  const page = createCapturePage(definition, uploads);

  try {
    await page.refreshImageStatuses();

    assert.deepEqual(requestedIds.map(ids => ids.length), [9, 1]);
    assert.deepEqual(page.data.uploads.map(item => item.status), Array(10).fill('segmented'));
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


test('capture shows the backend failure reason when failed status is tapped', () => {
  const modals = [];
  global.wx = { showModal(options) { modals.push(options); } };
  const definition = loadCapturePage({});
  const page = createCapturePage(definition);

  try {
    page.showFailureReason({ currentTarget: { dataset: {
      message: '识别服务响应超时，请稍后重试',
      imageId: 'image-1',
    } } });

    assert.deepEqual(modals, [{
      title: '识别失败',
      content: '识别服务响应超时，请稍后重试',
      showCancel: false,
    }]);
    assert.equal(modals[0].content.includes('image-1'), false);
  } finally {
    delete global.wx;
    delete global.Page;
    delete require.cache[capturePath];
    delete require.cache[apiPath];
  }
});


test('capture falls back to a safe failure reason when no message is available', () => {
  const modals = [];
  global.wx = { showModal(options) { modals.push(options); } };
  const definition = loadCapturePage({});
  const page = createCapturePage(definition);

  try {
    page.showFailureReason({ currentTarget: { dataset: {} } });

    assert.equal(modals[0].content, '识别暂时失败，请稍后重试');
  } finally {
    delete global.wx;
    delete global.Page;
    delete require.cache[capturePath];
    delete require.cache[apiPath];
  }
});


test('capture persists a submitted image immediately after upload succeeds', async () => {
  const stored = {};
  global.wx = {
    getStorageSync: key => key === 'studentId' ? 'student-1' : '',
    setStorageSync(key, value) { stored[key] = value; },
    showToast() {},
  };
  const definition = loadCapturePage({
    uploadImage: () => Promise.resolve({ image_id: 'image-1', status: 'pending' }),
  });
  const page = createCapturePage(definition, [{
    id: 'local-1', path: '/tmp/question.jpg', status: 'pending', subject: 'chinese',
  }]);
  page.startStatusPolling = () => Promise.resolve();

  try {
    await page.uploadPending();

    assert.deepEqual(stored['captureBackgroundUploads:student-1'].map(item => item.imageId), ['image-1']);
    assert.deepEqual(page.data.backgroundUploads, []);
  } finally {
    delete global.wx;
    delete global.Page;
    delete require.cache[capturePath];
    delete require.cache[apiPath];
  }
});


test('capture restores incomplete server tasks when local cache is empty', async () => {
  global.wx = {
    getStorageSync(key) { return key === 'token' ? 'token' : ''; },
    setStorageSync() {},
    showToast() {},
  };
  const definition = loadCapturePage({
    getProfile: () => Promise.resolve({ grade: 1, semester: 1 }),
    listIncompleteImageStatuses: () => Promise.resolve([{
      image_id: 'image-1',
      status: 'failed',
      question_count: 0,
      error_code: 'vision_timeout',
      error_message: '识别服务响应超时，请稍后重试',
    }]),
    getImageStatuses: () => Promise.resolve([]),
  });
  const page = createCapturePage(definition);

  try {
    await page.onShow();

    assert.deepEqual(page.data.backgroundUploads, [{
      imageId: 'image-1',
      status: 'failed',
      questionCount: 0,
      errorCode: 'vision_timeout',
      errorMessage: '识别服务响应超时，请稍后重试',
    }]);
  } finally {
    delete global.wx;
    delete global.Page;
    delete require.cache[capturePath];
    delete require.cache[apiPath];
  }
});


test('capture restores a retried failed image after a later page recreation', async () => {
  global.wx = {
    getStorageSync(key) { return key === 'token' ? 'token' : ''; },
    setStorageSync() {},
    showToast() {},
  };
  const apiOverrides = {
    getProfile: () => Promise.resolve({ grade: 1, semester: 1 }),
    retryImage: () => Promise.resolve({ image_id: 'image-1', status: 'pending' }),
    listIncompleteImageStatuses: () => Promise.resolve([{
      image_id: 'image-1',
      status: 'pending',
      question_count: 0,
      error_code: null,
      error_message: null,
    }]),
    getImageStatuses: () => Promise.resolve([]),
  };
  const firstDefinition = loadCapturePage(apiOverrides);
  const firstPage = createCapturePage(firstDefinition);
  firstPage.data.backgroundUploads = [{ imageId: 'image-1', status: 'failed' }];
  firstPage.startStatusPolling = () => Promise.resolve();

  try {
    await firstPage.retryImage('image-1');

    const secondDefinition = loadCapturePage(apiOverrides);
    const secondPage = createCapturePage(secondDefinition);
    secondPage.startStatusPolling = () => Promise.resolve();
    await secondPage.onShow();

    assert.equal(secondPage.data.backgroundUploads[0].imageId, 'image-1');
    assert.equal(secondPage.data.backgroundUploads[0].status, 'pending');
  } finally {
    delete global.wx;
    delete global.Page;
    delete require.cache[capturePath];
    delete require.cache[apiPath];
  }
});


test('capture removal explains that only pending review questions are discarded', async () => {
  let modal;
  let cancelledIds;
  global.wx = {
    getStorageSync() { return ''; },
    setStorageSync() {},
    showModal(options) {
      modal = options;
      options.success({ confirm: true });
    },
    showToast() {},
  };
  const definition = loadCapturePage({
    cancelImages(imageIds) {
      cancelledIds = imageIds;
      return Promise.resolve({ cancelled_image_ids: imageIds });
    },
  });
  const page = createCapturePage(definition);
  page.data.backgroundUploads = [
    { imageId: 'review-1', status: 'needs_review' },
    { imageId: 'failed-1', status: 'failed' },
  ];

  try {
    await page.onRemoveBackgroundTap({ currentTarget: { dataset: { imageId: 'review-1' } } });

    assert.equal(modal.content, '待确认题将不收录；已自动收录的错题会保留。');
    assert.deepEqual(cancelledIds, ['review-1']);
    assert.deepEqual(page.data.backgroundUploads, [
      { imageId: 'failed-1', status: 'failed' },
    ]);
  } finally {
    delete global.wx;
    delete global.Page;
    delete require.cache[capturePath];
    delete require.cache[apiPath];
  }
});


test('capture bulk removal cancels every visible background task', async () => {
  let cancelledIds;
  global.wx = {
    getStorageSync() { return ''; },
    setStorageSync() {},
    showModal(options) { options.success({ confirm: true }); },
    showToast() {},
  };
  const definition = loadCapturePage({
    cancelImages(imageIds) {
      cancelledIds = imageIds;
      return Promise.resolve({ cancelled_image_ids: imageIds });
    },
  });
  const page = createCapturePage(definition);
  page.data.backgroundUploads = [
    { imageId: 'failed-1', status: 'failed' },
    { imageId: 'review-1', status: 'needs_review' },
  ];

  try {
    await page.onClearAllBackgroundTasks();

    assert.deepEqual(cancelledIds, ['failed-1', 'review-1']);
    assert.deepEqual(page.data.backgroundUploads, []);
  } finally {
    delete global.wx;
    delete global.Page;
    delete require.cache[capturePath];
    delete require.cache[apiPath];
  }
});
