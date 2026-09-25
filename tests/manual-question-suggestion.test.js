const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const pagePath = path.resolve(__dirname, '..', 'pages', 'manual-question', 'manual-question.js');
const apiPath = path.resolve(__dirname, '..', 'utils', 'api.js');

function loadPage(api) {
  let definition;
  delete require.cache[pagePath];
  require.cache[apiPath] = { id: apiPath, filename: apiPath, loaded: true, exports: api };
  global.Page = value => { definition = value; };
  require(pagePath);
  return {
    ...definition,
    data: { ...definition.data, imageId: 'image-1', bbox: [0.1, 0.2, 0.4, 0.5] },
    setData(values) { Object.assign(this.data, values); },
  };
}

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

test('manual selection shows OCR draft first and fills remaining LLM suggestions without replacing user edits', async () => {
  const ocr = deferred();
  const llm = deferred();
  global.wx = { pageScrollTo() {}, showToast() {} };
  const calls = [];
  const page = loadPage({
    getManualQuestionSuggestion(imageId, bbox, mode) {
      calls.push({ imageId, bbox, mode });
      return mode === 'ocr' ? ocr.promise : llm.promise;
    },
  });

  try {
    const finished = page.onContinue();
    assert.equal(page.data.step, 'fields');
    assert.deepEqual(calls.map(call => call.mode), ['ocr', 'llm']);

    ocr.resolve({ mode: 'ocr', ocr_text: 'qiū liáng', fields: { prompt_text: 'qiū liáng' } });
    await Promise.resolve();
    assert.equal(page.data.prompt_text, 'qiū liáng');

    page.onFieldInput({ currentTarget: { dataset: { field: 'correct_answer' } }, detail: { value: '我填写的答案' } });
    llm.resolve({ mode: 'llm', ocr_text: '', fields: {
      instruction: '看拼音写词语', prompt_text: 'qiū liáng', question_type: 'write_word',
      correct_answer: '秋凉', student_answer: '秋良',
    } });
    await finished;

    assert.equal(page.data.instruction, '看拼音写词语');
    assert.equal(page.data.question_type, 'write_word');
    assert.equal(page.data.correct_answer, '我填写的答案');
    assert.equal(page.data.student_answer, '秋良');
    assert.equal(page.data.ocrDraftText, 'qiū liáng');
  } finally {
    delete global.Page;
    delete global.wx;
    delete require.cache[pagePath];
    delete require.cache[apiPath];
  }
});

test('late model suggestion cannot overwrite fields after returning to range selection', async () => {
  const llm = deferred();
  global.wx = { pageScrollTo() {}, showToast() {} };
  const calls = [];
  const page = loadPage({
    getManualQuestionSuggestion(_imageId, _bbox, mode) {
      calls.push(mode);
      return mode === 'ocr'
        ? Promise.resolve({ mode: 'ocr', ocr_text: '', fields: {} })
        : llm.promise;
    },
  });

  try {
    const finished = page.onContinue();
    assert.deepEqual(calls, ['ocr', 'llm']);
    page.backToSelection();
    llm.resolve({ mode: 'llm', ocr_text: '', fields: { correct_answer: '旧选区答案' } });
    await finished;
    assert.equal(page.data.correct_answer, '');
  } finally {
    delete global.Page;
    delete global.wx;
    delete require.cache[pagePath];
    delete require.cache[apiPath];
  }
});

test('OCR arriving after the model cannot replace its question text', async () => {
  const ocr = deferred();
  global.wx = { pageScrollTo() {}, showToast() {} };
  const page = loadPage({
    getManualQuestionSuggestion(_imageId, _bbox, mode) {
      return mode === 'ocr' ? ocr.promise : Promise.resolve({
        mode: 'llm', ocr_text: '', fields: { prompt_text: '完整题面' },
      });
    },
  });

  try {
    const finished = page.onContinue();
    await Promise.resolve();
    assert.equal(page.data.prompt_text, '完整题面');
    ocr.resolve({ mode: 'ocr', ocr_text: '残缺 OCR', fields: { prompt_text: '残缺 OCR' } });
    await finished;
    assert.equal(page.data.prompt_text, '完整题面');
  } finally {
    delete global.Page;
    delete global.wx;
    delete require.cache[pagePath];
    delete require.cache[apiPath];
  }
});

test('suggestion failures leave the form editable', async () => {
  global.wx = { pageScrollTo() {}, showToast() {} };
  const page = loadPage({
    getManualQuestionSuggestion() { return Promise.reject(new Error('offline')); },
  });

  try {
    await page.onContinue();
    page.onFieldInput({ currentTarget: { dataset: { field: 'prompt_text' } }, detail: { value: '手动题面' } });
    assert.equal(page.data.step, 'fields');
    assert.equal(page.data.prompt_text, '手动题面');
    assert.match(page.data.llmSuggestionStatus, /手动填写/);
  } finally {
    delete global.Page;
    delete global.wx;
    delete require.cache[pagePath];
    delete require.cache[apiPath];
  }
});
