const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const apiPath = path.join(root, 'utils', 'api.js');
const pagePath = path.join(root, 'pages', 'question-detail', 'detail.js');

test('question detail prepares structured model context for manual review', async () => {
  const api = require(apiPath);
  const originalGetQuestion = api.getQuestion;
  let pageDefinition;

  api.getQuestion = () => Promise.resolve({
    id: 'review-question',
    subject: 'chinese',
    image_url: '/uploads/question.jpg',
    ocr_text: 'qin tin',
    ocr_answer: 'qīng tíng',
    ocr_raw_json: {
      normalized_text: 'qīng tíng',
      confidence: 0.764,
      uncertain_segments: ['tin'],
    },
  });
  global.Page = definition => { pageDefinition = definition; };
  delete require.cache[pagePath];
  require(pagePath);

  const page = {
    ...pageDefinition,
    data: { ...pageDefinition.data },
    setData(values) { Object.assign(this.data, values); },
  };

  try {
    await page.onLoad({ id: 'review-question' });
    assert.deepEqual(page.data.reviewInfo, {
      normalizedText: 'qīng tíng',
      answer: 'qīng tíng',
      confidenceText: '76%',
      uncertainSegments: ['tin'],
    });

    const template = fs.readFileSync(
      path.join(root, 'pages', 'question-detail', 'detail.wxml'),
      'utf8'
    );
    assert.match(template, /规范内容/);
    assert.match(template, /建议答案/);
    assert.match(template, /置信度/);
    assert.match(template, /不确定片段/);
  } finally {
    api.getQuestion = originalGetQuestion;
    delete global.Page;
    delete require.cache[pagePath];
  }
});
