const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const apiPath = path.join(root, 'utils', 'api.js');
const questionsPath = path.join(root, 'pages', 'questions', 'questions.js');
const questionsTemplate = path.join(root, 'pages', 'questions', 'questions.wxml');
const sheetPath = path.join(root, 'pages', 'sheet', 'sheet.js');
const sheetTemplate = path.join(root, 'pages', 'sheet', 'sheet.wxml');

test('questions page confirms and deletes every selected question in order', async () => {
  const api = require(apiPath);
  const originalDeleteQuestion = api.deleteQuestion;
  const deletedIds = [];
  const toasts = [];
  let modal;
  let definition;

  api.deleteQuestion = id => {
    deletedIds.push(id);
    return Promise.resolve();
  };
  global.wx = {
    showModal(options) {
      modal = options;
      options.success({ confirm: true });
    },
    showToast(options) { toasts.push(options); },
    getStorageSync() { return []; },
    setStorageSync() {},
  };
  global.Page = value => { definition = value; };
  delete require.cache[questionsPath];
  require(questionsPath);

  let reloads = 0;
  const page = {
    ...definition,
    data: {
      ...definition.data,
      questions: [
        { id: 'one', selected: true },
        { id: 'two', selected: true },
      ],
      selectedIds: ['one', 'two'],
      selectedCount: 2,
    },
    setData(values) { Object.assign(this.data, values); },
    load() {
      reloads += 1;
      return Promise.resolve();
    },
  };

  try {
    await page.onDeleteSelected();

    assert.match(modal.content, /2/);
    assert.deepEqual(deletedIds, ['one', 'two']);
    assert.equal(reloads, 1);
    assert.equal(page.data.deleting, false);
    assert.equal(toasts[0].title, '已删除 2 道');

    const template = fs.readFileSync(questionsTemplate, 'utf8');
    assert.match(template, /删除已选（\{\{selectedCount\}\}）/);
    assert.match(template, /bindtap="onDeleteSelected"/);
  } finally {
    api.deleteQuestion = originalDeleteQuestion;
    delete global.wx;
    delete global.Page;
    delete require.cache[questionsPath];
  }
});

test('questions page keeps failed deletions in the stored sheet selection', async () => {
  const api = require(apiPath);
  const originalDeleteQuestion = api.deleteQuestion;
  const storedValues = [];
  const toasts = [];
  let definition;

  api.deleteQuestion = id => (
    id === 'failed' ? Promise.reject(new Error('delete failed')) : Promise.resolve()
  );
  global.wx = {
    showToast(options) { toasts.push(options); },
    getStorageSync() { return ['deleted', 'failed', 'unrelated']; },
    setStorageSync(_key, value) { storedValues.push(value); },
  };
  global.Page = value => { definition = value; };
  delete require.cache[questionsPath];
  require(questionsPath);

  const page = {
    ...definition,
    data: { ...definition.data },
    setData(values) { Object.assign(this.data, values); },
    load() { return Promise.resolve(); },
  };

  try {
    await page.deleteSelectedQuestions(['deleted', 'failed']);

    assert.deepEqual(storedValues[0], ['failed', 'unrelated']);
    assert.equal(toasts[0].title, '成功1道，失败1道');
    assert.equal(page.data.deleting, false);
  } finally {
    api.deleteQuestion = originalDeleteQuestion;
    delete global.wx;
    delete global.Page;
    delete require.cache[questionsPath];
  }
});

test('sheet history displays created_at in Beijing time', async () => {
  let definition;
  delete require.cache[sheetPath];
  require.cache[apiPath] = {
    id: apiPath,
    filename: apiPath,
    loaded: true,
    exports: {
      listSheets: () => Promise.resolve([
        {
          id: 'sheet-id',
          title: '错题重练',
          created_at: '2026-07-23T14:43:07.804045',
        },
      ]),
    },
  };
  global.wx = {
    getStorageSync() { return []; },
    showToast() {},
  };
  global.Page = value => { definition = value; };
  require(sheetPath);

  const page = {
    ...definition,
    data: { ...definition.data },
    setData(values) { Object.assign(this.data, values); },
  };

  try {
    await page.onShow();
    assert.equal(page.data.sheets[0].createdAtText, '2026-07-23 22:43');

    const template = fs.readFileSync(sheetTemplate, 'utf8');
    assert.match(template, /\{\{item\.createdAtText\}\}/);
  } finally {
    delete global.wx;
    delete global.Page;
    delete require.cache[sheetPath];
    delete require.cache[apiPath];
  }
});

test('capture upload summary uses a centered three-column layout', () => {
  const wxml = fs.readFileSync(
    path.join(root, 'pages', 'capture', 'capture.wxml'),
    'utf8'
  );
  const wxss = fs.readFileSync(
    path.join(root, 'pages', 'capture', 'capture.wxss'),
    'utf8'
  );

  assert.match(wxml, /class="upload-page"/);
  assert.match(wxml, /class="status upload-status status-\{\{item\.status\}\}"/);
  assert.match(wxss, /\.upload-item\s*\{[^}]*display:\s*grid;/s);
  assert.match(wxss, /grid-template-columns:\s*repeat\(3,\s*1fr\);/);
  assert.match(wxss, /\.upload-status\s*\{[^}]*justify-self:\s*center;/s);
  assert.match(wxss, /\.subject-tag\s*\{[^}]*justify-self:\s*center;/s);
});
