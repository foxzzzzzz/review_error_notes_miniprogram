const fs = require('fs');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const read = relativePath => fs.readFileSync(path.join(root, relativePath), 'utf8');

test('review page preloads crops for the active group and explains why confirmation is needed', () => {
  const script = read('pages/review-images/review-images.js');
  const template = read('pages/review-images/review-images.wxml');

  assert.match(script, /loadActiveGroupCrops/);
  assert.match(script, /loadCrop\(e\)/);
  assert.match(script, /cropGeneration/);
  assert.match(template, /collection_reason/);
  assert.match(template, /bindtap="loadCrop"/);
});

test('review page separates historical supplements from pending review groups', () => {
  const script = read('pages/review-images/review-images.js');
  const template = read('pages/review-images/review-images.wxml');

  assert.match(script, /pendingGroups/);
  assert.match(script, /historyGroups/);
  assert.match(template, /待确认图片/);
  assert.match(template, /已处理图片（可补充）/);
  assert.match(template, /historyExpanded/);
  assert.doesNotMatch(template, /groups\}\}.*completed_image/);
});

test('review template closes its conditional blocks around the history and current-group views', () => {
  const template = read('pages/review-images/review-images.wxml');

  assert.match(template, /<view wx:if="\{\{loading\}\}"[\s\S]*?<block wx:else>[\s\S]*?<view wx:if="\{\{historyGroups\.length\}\}"/);
  assert.match(template, /<view wx:if="\{\{currentGroup\}\}">[\s\S]*?<\/block>\s*<\/view>\s*<\/block>\s*<\/view>\s*$/);
});

test('review page preloads active group crops only and ignores stale crop completions after switching', async () => {
  const pagePath = path.join(root, 'pages/review-images/review-images.js');
  const apiPath = path.join(root, 'utils/api.js');
  let definition;
  const cropCalls = [];
  const deferred = {};
  let activeDownloads = 0;
  let peakDownloads = 0;
  const question = id => ({ id, ocr_answer: '', review_fields: {} });
  require.cache[apiPath] = { id: apiPath, filename: apiPath, loaded: true, exports: {
    listReviewImages: () => Promise.resolve([
      { image_id: 'pending-1', group_type: 'questions', question_count: 2, questions: [question('q1'), question('q2')] },
      { image_id: 'pending-2', group_type: 'questions', question_count: 1, questions: [question('q3')] },
      { image_id: 'history-1', group_type: 'completed_image', question_count: 0, questions: [] },
    ]),
    downloadQuestionImage: (id, view) => {
      if (view === 'original') return Promise.resolve(`${id}-original.jpg`);
      cropCalls.push(id);
      activeDownloads += 1;
      peakDownloads = Math.max(peakDownloads, activeDownloads);
      return new Promise(resolve => {
        deferred[id] = path => {
          activeDownloads -= 1;
          resolve(path);
        };
      });
    },
  } };
  global.Page = value => { definition = value; };
  global.wx = { showToast() {} };
  delete require.cache[pagePath];
  require(pagePath);
  const page = { ...definition, data: { ...definition.data }, setData(values) { Object.assign(this.data, values); } };
  try {
    const initialLoad = page.loadGroups();
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(cropCalls, ['q1', 'q2']);
    assert.equal(page.data.pendingGroups.length, 2);
    assert.equal(page.data.historyGroups.length, 1);

    const secondGroupLoad = page.selectGroup(1);
    deferred.q1('q1-old.jpg');
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(cropCalls, ['q1', 'q2', 'q3']);
    deferred.q2('q2-old.jpg');
    deferred.q3('q3.jpg');
    await Promise.all([initialLoad, secondGroupLoad]);
    assert.equal(peakDownloads, 2);
    assert.equal(page.data.currentGroup.image_id, 'pending-2');
    assert.equal(page.data.currentGroup.questions[0].cropImagePath, 'q3.jpg');
    assert.equal(page.data.pendingGroups[0].questions[0].cropImagePath, 'q1-old.jpg');
    assert.equal(page.data.pendingGroups[0].questions[1].cropImagePath, 'q2-old.jpg');
    assert.deepEqual(cropCalls, ['q1', 'q2', 'q3']);
  } finally {
    delete global.Page;
    delete global.wx;
    delete require.cache[pagePath];
    delete require.cache[apiPath];
  }
});

test('failed active crop can be retried and a delayed original cannot replace the newly selected image', async () => {
  const pagePath = path.join(root, 'pages/review-images/review-images.js');
  const apiPath = path.join(root, 'utils/api.js');
  let definition;
  let resolveOriginal;
  let cropAttempt = 0;
  require.cache[apiPath] = { id: apiPath, filename: apiPath, loaded: true, exports: {
    listReviewImages: () => Promise.resolve([
      { image_id: 'pending-1', group_type: 'questions', question_count: 1, questions: [{ id: 'q1', review_fields: {} }] },
      { image_id: 'pending-2', group_type: 'questions', question_count: 1, questions: [{ id: 'q2', review_fields: {} }] },
    ]),
    downloadQuestionImage: (id, view) => {
      if (view === 'original') return id === 'q1'
        ? new Promise(resolve => { resolveOriginal = resolve; })
        : Promise.resolve('q2-original.jpg');
      cropAttempt += 1;
      return id === 'q1' && cropAttempt === 1
        ? Promise.reject(new Error('temporary failure'))
        : Promise.resolve(`${id}-crop.jpg`);
    },
  } };
  global.Page = value => { definition = value; };
  global.wx = { showToast() {}, previewImage() {} };
  delete require.cache[pagePath];
  require(pagePath);
  const page = { ...definition, data: { ...definition.data }, setData(values) { Object.assign(this.data, values); } };
  try {
    const initialLoad = page.loadGroups();
    await new Promise(resolve => setImmediate(resolve));
    await page.loadCrop({ currentTarget: { dataset: { id: 'q1' } } });
    await page.selectGroup(1);
    resolveOriginal('q1-original.jpg');
    await initialLoad;
    assert.equal(page.data.originalImagePath, 'q2-original.jpg');
    assert.equal(page.data.pendingGroups[0].questions[0].cropImagePath, 'q1-crop.jpg');
    assert.equal(cropAttempt, 3);
  } finally {
    delete global.Page;
    delete global.wx;
    delete require.cache[pagePath];
    delete require.cache[apiPath];
  }
});

test('crop completion from before a group refresh cannot overwrite refreshed question state', async () => {
  const pagePath = path.join(root, 'pages/review-images/review-images.js');
  const apiPath = path.join(root, 'utils/api.js');
  let definition;
  const cropResolvers = [];
  require.cache[apiPath] = { id: apiPath, filename: apiPath, loaded: true, exports: {
    listReviewImages: () => Promise.resolve([
      { image_id: 'pending-1', group_type: 'questions', question_count: 1, questions: [{ id: 'q1', review_fields: {} }] },
    ]),
    downloadQuestionImage: (id, view) => view === 'original'
      ? Promise.resolve('original.jpg')
      : new Promise(resolve => cropResolvers.push(resolve)),
  } };
  global.Page = value => { definition = value; };
  global.wx = { showToast() {} };
  delete require.cache[pagePath];
  require(pagePath);
  const page = { ...definition, data: { ...definition.data }, setData(values) { Object.assign(this.data, values); } };
  try {
    const firstLoad = page.loadGroups();
    await new Promise(resolve => setImmediate(resolve));
    const refreshedLoad = page.loadGroups();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(cropResolvers.length, 2);
    cropResolvers[0]('old-crop.jpg');
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(page.data.currentGroup.questions[0].cropImagePath, '');
    cropResolvers[1]('new-crop.jpg');
    await Promise.all([firstLoad, refreshedLoad]);
    assert.equal(page.data.currentGroup.questions[0].cropImagePath, 'new-crop.jpg');
  } finally {
    delete global.Page;
    delete global.wx;
    delete require.cache[pagePath];
    delete require.cache[apiPath];
  }
});

test('submitting a review does not wait for a crop download that never completes', async () => {
  const pagePath = path.join(root, 'pages/review-images/review-images.js');
  const apiPath = path.join(root, 'utils/api.js');
  let definition;
  let listCalls = 0;
  require.cache[apiPath] = { id: apiPath, filename: apiPath, loaded: true, exports: {
    listReviewImages: () => Promise.resolve(++listCalls === 1 ? [{
      image_id: 'pending-1', group_type: 'questions', question_count: 1,
      questions: [{ id: 'q1', review_fields: {} }],
    }] : []),
    downloadQuestionImage: (id, view) => view === 'original'
      ? Promise.resolve('original.jpg') : new Promise(() => {}),
    decideImageReviews: () => Promise.resolve({ collected: 0, ignored: 1 }),
  } };
  global.Page = value => { definition = value; };
  global.wx = { showToast() {} };
  delete require.cache[pagePath];
  require(pagePath);
  const page = { ...definition, data: { ...definition.data }, setData(values) { Object.assign(this.data, values); } };
  try {
    const loaded = await Promise.race([
      page.loadGroups().then(() => true),
      new Promise(resolve => setTimeout(() => resolve(false), 30)),
    ]);
    assert.equal(loaded, true);
    page.onDecisionTap({ currentTarget: { dataset: { id: 'q1', decision: 'ignore' } } });
    await page.submitGroup();
    assert.equal(page.data.saving, false);
  } finally {
    delete global.Page;
    delete global.wx;
    delete require.cache[pagePath];
    delete require.cache[apiPath];
  }
});

test('delayed original from a prior refresh cannot replace a newer group thumbnail', async () => {
  const pagePath = path.join(root, 'pages/review-images/review-images.js');
  const apiPath = path.join(root, 'utils/api.js');
  let definition;
  let listCalls = 0;
  let resolveOldOriginal;
  require.cache[apiPath] = { id: apiPath, filename: apiPath, loaded: true, exports: {
    listReviewImages: () => Promise.resolve(++listCalls === 1 ? [{
      image_id: 'image-old', group_type: 'questions', question_count: 1,
      questions: [{ id: 'q-old', review_fields: {} }],
    }] : [{
      image_id: 'image-new', group_type: 'questions', question_count: 1,
      questions: [{ id: 'q-new', review_fields: {} }],
    }]),
    downloadQuestionImage: (id, view) => view === 'crop' ? Promise.resolve(`${id}-crop.jpg`)
      : id === 'q-old' ? new Promise(resolve => { resolveOldOriginal = resolve; })
        : Promise.resolve('new-original.jpg'),
  } };
  global.Page = value => { definition = value; };
  global.wx = { showToast() {} };
  delete require.cache[pagePath];
  require(pagePath);
  const page = { ...definition, data: { ...definition.data }, setData(values) { Object.assign(this.data, values); } };
  try {
    const oldLoad = page.loadGroups();
    await new Promise(resolve => setImmediate(resolve));
    await page.loadGroups();
    assert.equal(page.data.pendingGroups[0].thumbnailPath, 'new-original.jpg');
    resolveOldOriginal('old-original.jpg');
    await oldLoad;
    assert.equal(page.data.pendingGroups[0].image_id, 'image-new');
    assert.equal(page.data.pendingGroups[0].thumbnailPath, 'new-original.jpg');
  } finally {
    delete global.Page;
    delete global.wx;
    delete require.cache[pagePath];
    delete require.cache[apiPath];
  }
});

test('switching away and back requeues a crop that was waiting behind two active downloads', async () => {
  const pagePath = path.join(root, 'pages/review-images/review-images.js');
  const apiPath = path.join(root, 'utils/api.js');
  let definition;
  const cropCalls = [];
  const cropResolvers = {};
  const question = id => ({ id, review_fields: {} });
  require.cache[apiPath] = { id: apiPath, filename: apiPath, loaded: true, exports: {
    listReviewImages: () => Promise.resolve([
      { image_id: 'group-a', group_type: 'questions', question_count: 3, questions: [question('q1'), question('q2'), question('q3')] },
      { image_id: 'group-b', group_type: 'questions', question_count: 1, questions: [question('q4')] },
    ]),
    downloadQuestionImage: (id, view) => {
      if (view === 'original') return Promise.resolve(`${id}-original.jpg`);
      cropCalls.push(id);
      return new Promise(resolve => { cropResolvers[id] = resolve; });
    },
  } };
  global.Page = value => { definition = value; };
  global.wx = { showToast() {} };
  delete require.cache[pagePath];
  require(pagePath);
  const page = { ...definition, data: { ...definition.data }, setData(values) { Object.assign(this.data, values); } };
  try {
    await page.loadGroups();
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(cropCalls, ['q1', 'q2']);
    await page.selectGroup(1);
    await page.selectGroup(0);
    cropResolvers.q1('q1-crop.jpg');
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(cropCalls, ['q1', 'q2', 'q3']);
    cropResolvers.q2('q2-crop.jpg');
    cropResolvers.q3('q3-crop.jpg');
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(page.data.currentGroup.image_id, 'group-a');
    assert.equal(page.data.currentGroup.questions[2].cropImagePath, 'q3-crop.jpg');
  } finally {
    delete global.Page;
    delete global.wx;
    delete require.cache[pagePath];
    delete require.cache[apiPath];
  }
});

test('question list and review page highlight an empty student answer', () => {
  const questionsTemplate = read('pages/questions/questions.wxml');
  const reviewTemplate = read('pages/review-images/review-images.wxml');
  const questionsStyles = read('pages/questions/questions.wxss');
  const reviewStyles = read('pages/review-images/review-images.wxss');

  assert.match(questionsTemplate, /class="[^"]*empty-answer[^"]*"[^>]*>【空白】/);
  assert.match(reviewTemplate, /class="[^"]*empty-answer[^"]*"[^>]*>【空白】/);
  assert.match(questionsStyles, /\.empty-answer[\s\S]*color:\s*#c77700/);
  assert.match(reviewStyles, /\.empty-answer[\s\S]*color:\s*#c77700/);
});

test('question list displays the number of pending review questions', () => {
  const script = read('pages/questions/questions.js');
  const template = read('pages/questions/questions.wxml');

  assert.match(script, /loadReviewSummary/);
  assert.match(template, /reviewQuestionCount/);
});

test('review page exposes per-image thumbnails and a correction reprocessing action', () => {
  const script = read('pages/review-images/review-images.js');
  const template = read('pages/review-images/review-images.wxml');

  assert.match(script, /onReprocessTap/);
  assert.match(script, /reprocessReviewImage/);
  assert.match(template, /group-thumbnail/);
  assert.match(template, /本图识别不准确/);
});


test('review page explains the collected and pending counts for the same image', () => {
  const template = read('pages/review-images/review-images.wxml');

  assert.match(template, /本图已收录\{\{currentGroup\.auto_collected_count\}\}题/);
  assert.match(template, /另有\{\{currentGroup\.question_count\}\}题需要你确认/);
});

test('review page loads only the active group original image on first open', () => {
  const script = read('pages/review-images/review-images.js');

  assert.doesNotMatch(script, /Promise\.all\(prepared\.map/);
  assert.match(script, /loadGroupOriginal/);
});

test('image issue group renders recovery actions without empty bulk decisions', () => {
  const script = read('pages/review-images/review-images.js');
  const template = read('pages/review-images/review-images.wxml');

  assert.match(template, /currentGroup\.group_type === 'image_issue'/);
  assert.match(template, /未能可靠定位错题/);
  assert.match(template, /重新识别红标/);
  assert.match(template, /按无红标作业分析/);
  assert.match(script, /force_unmarked/);
  assert.match(script, /missed_errors/);
  assert.match(script, /downloadNormalizedOriginalImage/);
  assert.match(script, /cancelImages/);
});

test('collecting a candidate starts with the model answer suggestion and permits correction', async () => {
  const pagePath = path.join(root, 'pages/review-images/review-images.js');
  const apiPath = path.join(root, 'utils/api.js');
  let definition;
  delete require.cache[pagePath];
  require.cache[apiPath] = { id: apiPath, filename: apiPath, loaded: true, exports: {
    listReviewImages: () => Promise.resolve([{
      image_id: 'image-1', group_type: 'questions', question_count: 1,
      questions: [{ id: 'question-1', ocr_answer: '冰块', answer_status: 'suggested',
        review_fields: { instruction: '看拼音写词语', prompt_text: 'bīng kuài', question_type: 'write_word' } }],
    }]),
    downloadQuestionImage: () => Promise.resolve('original.jpg'),
  } };
  global.Page = value => { definition = value; };
  global.wx = { showToast() {} };
  require(pagePath);
  const page = { ...definition, data: { ...definition.data }, setData(values) { Object.assign(this.data, values); } };
  try {
    await page.loadGroups();
    page.onDecisionTap({ currentTarget: { dataset: { id: 'question-1', decision: 'collect' } } });
    assert.equal(page.data.currentGroup.questions[0].review_fields.correct_answer, '冰块');
    page.onReviewFieldInput({ currentTarget: { dataset: { id: 'question-1', field: 'correct_answer' } }, detail: { value: '冰砖' } });
    assert.equal(page.data.currentGroup.questions[0].review_fields.correct_answer, '冰砖');
  } finally {
    delete global.Page;
    delete global.wx;
    delete require.cache[pagePath];
    delete require.cache[apiPath];
  }
});
