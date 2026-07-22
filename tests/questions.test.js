const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const apiPath = path.join(root, 'utils', 'api.js');
const pagePath = path.join(root, 'pages', 'questions', 'questions.js');

test('questions page prepares difficulty text for WXML rendering', async () => {
  const api = require(apiPath);
  const originalListQuestions = api.listQuestions;
  let pageDefinition;

  api.listQuestions = () => Promise.resolve([
    { id: 'with-difficulty', difficulty: 3 },
    { id: 'without-difficulty', difficulty: null },
  ]);
  global.Page = definition => { pageDefinition = definition; };
  delete require.cache[pagePath];
  require(pagePath);

  const page = {
    ...pageDefinition,
    data: { ...pageDefinition.data },
    setData(values) { Object.assign(this.data, values); },
  };

  try {
    await page.load();
    assert.equal(page.data.questions[0].difficultyStars, '⭐⭐⭐');
    assert.equal(page.data.questions[1].difficultyStars, '?');

    const template = fs.readFileSync(
      path.join(root, 'pages', 'questions', 'questions.wxml'),
      'utf8'
    );
    assert.match(template, /\{\{item\.difficultyStars\}\}/);
    assert.doesNotMatch(template, /\.repeat\s*\(/);
  } finally {
    api.listQuestions = originalListQuestions;
    delete global.Page;
    delete require.cache[pagePath];
  }
});

test('questions page renders human-readable vision review status', async () => {
  const api = require(apiPath);
  const originalListQuestions = api.listQuestions;
  let pageDefinition;

  api.listQuestions = () => Promise.resolve([
    { id: 'review', difficulty: 1, status: 'needs_review' },
    { id: 'done', difficulty: 1, status: 'confirmed' },
  ]);
  global.Page = definition => { pageDefinition = definition; };
  delete require.cache[pagePath];
  require(pagePath);

  const page = {
    ...pageDefinition,
    data: { ...pageDefinition.data },
    setData(values) { Object.assign(this.data, values); },
  };

  try {
    await page.load();
    assert.equal(page.data.questions[0].statusText, '待确认');
    assert.equal(page.data.questions[1].statusText, '已确认');

    const listTemplate = fs.readFileSync(
      path.join(root, 'pages', 'questions', 'questions.wxml'),
      'utf8'
    );
    assert.match(listTemplate, /item\.statusText/);

    const detailTemplate = fs.readFileSync(
      path.join(root, 'pages', 'question-detail', 'detail.wxml'),
      'utf8'
    );
    assert.match(detailTemplate, /识别文字/);
    assert.doesNotMatch(detailTemplate, /OCR 文字/);
  } finally {
    api.listQuestions = originalListQuestions;
    delete global.Page;
    delete require.cache[pagePath];
  }
});
