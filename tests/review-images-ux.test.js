const fs = require('fs');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const read = relativePath => fs.readFileSync(path.join(root, relativePath), 'utf8');

test('review page loads crop images only on demand and explains why confirmation is needed', () => {
  const script = read('pages/review-images/review-images.js');
  const template = read('pages/review-images/review-images.wxml');

  assert.match(script, /loadCrop\(e\)/);
  assert.doesNotMatch(script, /const cropRequests =/);
  assert.match(template, /collection_reason/);
  assert.match(template, /bindtap="loadCrop"/);
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
