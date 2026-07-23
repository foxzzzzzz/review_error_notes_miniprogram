const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const apiPath = path.join(root, 'utils', 'api.js');
const pagePath = path.join(root, 'pages', 'question-detail', 'detail.js');

const question = {
  id: 'review-question',
  subject: 'chinese',
  image_url: '/uploads/question.jpg',
  difficulty: 3,
  ocr_text: 'qin tin',
  ocr_answer: 'qīng tíng',
  crop_region: {
    bbox: [0.1, 0.2, 0.4, 0.5],
    localization_status: 'verified',
  },
  ocr_raw_json: {
    normalized_text: 'qīng tíng',
    confidence: 0.764,
    uncertain_segments: ['tin'],
  },
};

function createHarness(
  downloadImpl = (_id, view) =>
    Promise.resolve(view === 'crop' ? 'wxfile://crop.jpg' : 'wxfile://original.jpg'),
  deleteImpl = () => Promise.resolve()
) {
  const api = require(apiPath);
  const originalGetQuestion = api.getQuestion;
  const originalDownloadQuestionImage = api.downloadQuestionImage;
  const originalDeleteQuestion = api.deleteQuestion;
  const originalPage = global.Page;
  const originalWx = global.wx;
  const downloads = [];
  const previews = [];
  const toasts = [];
  let currentDownloadImpl = downloadImpl;
  let currentDeleteImpl = deleteImpl;
  let pageDefinition;

  api.getQuestion = () => Promise.resolve({ ...question });
  api.downloadQuestionImage = (id, view) => {
    downloads.push([id, view]);
    return currentDownloadImpl(id, view);
  };
  api.deleteQuestion = id => currentDeleteImpl(id);
  global.wx = {
    previewImage(options) { previews.push(options); },
    showToast(options) { toasts.push(options); },
    showModal(options) { options.success({ confirm: true }); },
    navigateBack() {},
  };
  global.Page = definition => { pageDefinition = definition; };
  delete require.cache[pagePath];
  require(pagePath);

  const page = {
    ...pageDefinition,
    data: JSON.parse(JSON.stringify(pageDefinition.data)),
    setData(values) {
      for (const [key, value] of Object.entries(values)) {
        const parts = key.split('.');
        let target = this.data;
        for (let index = 0; index < parts.length - 1; index++) {
          target = target[parts[index]];
        }
        target[parts[parts.length - 1]] = value;
      }
    },
  };

  return {
    page,
    downloads,
    previews,
    toasts,
    setDownloadImpl(value) { currentDownloadImpl = value; },
    setDeleteImpl(value) { currentDeleteImpl = value; },
    cleanup() {
      api.getQuestion = originalGetQuestion;
      api.downloadQuestionImage = originalDownloadQuestionImage;
      api.deleteQuestion = originalDeleteQuestion;
      global.Page = originalPage;
      global.wx = originalWx;
      delete require.cache[pagePath];
    },
  };
}

test('question detail prepares review context and loads the cropped image', async () => {
  const harness = createHarness();

  try {
    await harness.page.onLoad({ id: 'review-question' });

    assert.deepEqual(harness.page.data.reviewInfo, {
      normalizedText: 'qīng tíng',
      answer: 'qīng tíng',
      confidenceText: '76%',
      uncertainSegments: ['tin'],
    });
    assert.deepEqual(harness.downloads, [['review-question', 'crop']]);
    assert.equal(harness.page.data.cropImagePath, 'wxfile://crop.jpg');
    assert.equal(harness.page.data.imageLoading, false);
    assert.equal(harness.page.data.imageError, '');
  } finally {
    harness.cleanup();
  }
});

test('question detail explains when an unverified region falls back to the original image', async () => {
  const harness = createHarness();

  try {
    const api = require(apiPath);
    api.getQuestion = () => Promise.resolve({
      ...question,
      crop_region: {
        bbox_source: 'unverified',
        localization_status: 'needs_review',
        index: 0,
      },
    });

    await harness.page.onLoad({ id: 'review-question' });

    assert.equal(
      harness.page.data.localizationNotice,
      '题目区域定位不确定，已展示完整原图'
    );
    const template = fs.readFileSync(
      path.join(root, 'pages', 'question-detail', 'detail.wxml'),
      'utf8'
    );
    assert.match(template, /localizationNotice/);
  } finally {
    harness.cleanup();
  }
});

test('question detail handles image failure, retry, and original preview', async () => {
  const harness = createHarness(() => Promise.reject(new Error('network')));

  try {
    harness.page.data.question = { ...question };
    await harness.page.loadCropImage();
    assert.equal(harness.page.data.cropImagePath, '');
    assert.equal(harness.page.data.imageError, '图片加载失败，请重试');
    assert.equal(harness.page.data.imageLoading, false);

    harness.setDownloadImpl((_id, view) =>
      Promise.resolve(view === 'crop' ? 'wxfile://crop-retry.jpg' : 'wxfile://original.jpg'));
    await harness.page.loadCropImage();
    assert.equal(harness.page.data.cropImagePath, 'wxfile://crop-retry.jpg');

    await harness.page.previewOriginal();
    assert.deepEqual(harness.downloads.at(-1), ['review-question', 'original']);
    assert.equal(harness.previews.length, 1);
    assert.deepEqual(harness.previews[0].urls, ['wxfile://original.jpg']);

    const downloadCount = harness.downloads.length;
    await harness.page.previewOriginal();
    assert.equal(harness.downloads.length, downloadCount);
    assert.equal(harness.previews.length, 2);

    harness.page.onImageError();
    assert.equal(harness.page.data.cropImagePath, '');
    assert.equal(harness.page.data.imageError, '图片加载失败，请重试');
  } finally {
    harness.cleanup();
  }
});

test('question detail uses a five-star difficulty control', async () => {
  const harness = createHarness();

  try {
    await harness.page.onLoad({ id: 'review-question' });
    assert.equal(harness.page.data.difficultyLabel, '中等');

    harness.page.onDifficultyTap({ currentTarget: { dataset: { value: 4 } } });
    assert.equal(harness.page.data.question.difficulty, 4);
    assert.equal(harness.page.data.difficultyLabel, '困难');

    const template = fs.readFileSync(
      path.join(root, 'pages', 'question-detail', 'detail.wxml'),
      'utf8'
    );
    assert.doesNotMatch(template, /<slider/);
    assert.match(template, /当前错题/);
    assert.match(template, /重新加载/);
    assert.match(template, /点击查看整张原图/);
    assert.match(template, /题目难度（用于生成同类练习）/);
    assert.match(template, /onDifficultyTap/);
  } finally {
    harness.cleanup();
  }
});

test('question detail deduplicates rapid original image requests', async () => {
  const resolvers = [];
  const harness = createHarness(() => new Promise(resolve => { resolvers.push(resolve); }));

  try {
    harness.page.data.question = { ...question };
    harness.page.data.cropImagePath = 'wxfile://crop.jpg';

    const firstPreview = harness.page.previewOriginal();
    const secondPreview = harness.page.previewOriginal();

    assert.deepEqual(harness.downloads, [['review-question', 'original']]);
    resolvers[0]('wxfile://original.jpg');
    await Promise.all([firstPreview, secondPreview]);
    assert.equal(harness.previews.length, 1);
  } finally {
    harness.cleanup();
  }
});

test('question detail maps image download status codes consistently', async () => {
  const harness = createHarness();

  try {
    harness.page.data.question = { ...question };

    for (const [statusCode, message] of [
      [404, '原图文件不存在，请重新录入'],
      [422, '图片文件损坏，无法显示'],
      [500, '图片加载失败，请重试'],
    ]) {
      harness.setDownloadImpl(() => Promise.reject({ statusCode }));
      await harness.page.loadCropImage();
      assert.equal(harness.page.data.imageError, message);

      await harness.page.previewOriginal();
      assert.equal(harness.toasts.at(-1).title, message);
    }
  } finally {
    harness.cleanup();
  }
});

test('question detail keeps crop image feedback empty after a 401 response', async () => {
  const harness = createHarness(() => Promise.reject({ statusCode: 401 }));

  try {
    harness.page.data.question = { ...question };
    harness.page.data.cropImagePath = 'wxfile://stale-crop.jpg';
    harness.page.data.imageError = 'previous error';

    await harness.page.loadCropImage();

    assert.equal(harness.page.data.cropImagePath, '');
    assert.equal(harness.page.data.imageLoading, false);
    assert.equal(harness.page.data.imageError, '');
    assert.equal(harness.toasts.length, 0);
  } finally {
    harness.cleanup();
  }
});

test('question detail does not toast for an original image 401 response', async () => {
  const harness = createHarness(() => Promise.reject({ statusCode: 401 }));

  try {
    harness.page.data.question = { ...question };

    await harness.page.previewOriginal();

    assert.equal(harness.page.data.imageLoading, false);
    assert.equal(harness.toasts.length, 0);
  } finally {
    harness.cleanup();
  }
});

test('question detail does not add a generic toast after an onLoad crop 404', async () => {
  const harness = createHarness(() => Promise.reject({ statusCode: 404 }));

  try {
    await harness.page.onLoad({ id: 'review-question' });

    assert.equal(harness.page.data.imageError, '原图文件不存在，请重新录入');
    assert.equal(harness.toasts.length, 0);
  } finally {
    harness.cleanup();
  }
});

test('question detail shows the backend delete failure message first', async () => {
  const harness = createHarness();

  try {
    harness.page.data.question = { ...question };
    harness.setDeleteImpl(() => Promise.reject({ message: '该错题已被删除' }));

    harness.page.remove();
    await new Promise(resolve => setImmediate(resolve));

    assert.equal(harness.toasts.at(-1).title, '该错题已被删除');
  } finally {
    harness.cleanup();
  }
});

test('question detail falls back when the delete failure has no message', async () => {
  const harness = createHarness();

  try {
    harness.page.data.question = { ...question };

    for (const error of [{}, { message: '' }]) {
      harness.setDeleteImpl(() => Promise.reject(error));
      harness.page.remove();
      await new Promise(resolve => setImmediate(resolve));
      assert.equal(harness.toasts.at(-1).title, '删除失败');
    }
  } finally {
    harness.cleanup();
  }
});
