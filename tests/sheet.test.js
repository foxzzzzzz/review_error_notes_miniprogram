const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');


const pageDir = path.resolve(__dirname, '..', 'pages', 'sheet');
const js = fs.readFileSync(path.join(pageDir, 'sheet.js'), 'utf8');
const wxml = fs.readFileSync(path.join(pageDir, 'sheet.wxml'), 'utf8');
const sheetPath = path.join(pageDir, 'sheet.js');
const apiPath = path.resolve(__dirname, '..', 'utils', 'api.js');


function loadSheetPage(apiOverrides = {}) {
  let definition;
  delete require.cache[sheetPath];
  require.cache[apiPath] = {
    id: apiPath,
    filename: apiPath,
    loaded: true,
    exports: {
      createSheet: () => Promise.resolve({ pdf_url: '/pdfs/a.pdf' }),
      listSheets: () => Promise.resolve([]),
      getSheetGeneration: () => Promise.resolve({ generation_status: 'completed' }),
      retrySheetGeneration: () => Promise.resolve({ generation_status: 'pending' }),
      resolveServerUrl: value => value,
      ...apiOverrides,
    },
  };
  global.Page = value => { definition = value; };
  require(sheetPath);
  return definition;
}


function createContext(page, data = {}) {
  return {
    ...page,
    data: { ...page.data, ...data },
    setData(values) { Object.assign(this.data, values); },
  };
}


test('sheet defaults to originals only', () => {
  assert.match(js, /derivedCount:\s*0/);
  assert.match(wxml, /<radio value="0" checked="\{\{derivedCount === 0\}\}"[^>]*\/>/);
  assert.match(wxml, /0道（仅原题）/);
});


test('difficulty options are hidden when no derivatives are requested', () => {
  assert.match(wxml, /wx:if="\{\{derivedCount > 0\}\}"/);
});


test('generate sends zero derivatives by default', async () => {
  let request;
  const page = loadSheetPage({
    createSheet: data => {
      request = data;
      return Promise.resolve({ pdf_url: '/pdfs/a.pdf' });
    },
  });
  global.wx = { showToast() {} };
  const context = createContext(page, { selectedIds: ['question-id'] });

  page.generate.call(context);
  await new Promise(resolve => setImmediate(resolve));

  assert.equal(request.derived_per_original, 0);
});


test('generate removes duplicate question IDs left in selection storage', async () => {
  let request;
  const page = loadSheetPage({
    createSheet: data => {
      request = data;
      return Promise.resolve({ pdf_url: '/pdfs/a.pdf' });
    },
  });
  global.wx = { showToast() {} };
  const context = createContext(page, {
    selectedIds: ['question-one', 'question-one', 'question-two'],
  });

  page.generate.call(context);
  await new Promise(resolve => setImmediate(resolve));

  assert.deepEqual(request.question_ids, ['question-one', 'question-two']);
});


test('generate shows the actionable backend error', async () => {
  let toast;
  const page = loadSheetPage({
    createSheet: () => Promise.reject(new Error('请重新上传图片识别后再出卷')),
  });
  global.wx = { showToast(options) { toast = options; } };
  const context = createContext(page, { selectedIds: ['question-id'] });

  page.generate.call(context);
  await new Promise(resolve => setImmediate(resolve));

  assert.equal(toast.title, '请重新上传图片识别后再出卷');
  assert.equal(toast.icon, 'none');
});


test('history exposes separate PDF and practice result actions', () => {
  assert.match(wxml, /bindtap="openSheet"/);
  assert.match(wxml, /bindtap="openResult"/);
  assert.match(wxml, /记录结果/);
  assert.match(wxml, /修改结果/);
});


test('generate immediately shows a persistent pending state and ignores a second tap', async () => {
  let createCalls = 0;
  let resolveCreate;
  const page = loadSheetPage({
    createSheet: () => {
      createCalls += 1;
      return new Promise(resolve => { resolveCreate = resolve; });
    },
  });
  global.wx = { showToast() {} };
  const context = createContext(page, {
    selectedIds: Array.from({ length: 57 }, (_, index) => `question-${index}`),
    derivedCount: 2,
  });

  const first = context.generate();
  const second = context.generate();

  assert.equal(createCalls, 1);
  assert.equal(context.data.generating, true);
  assert.equal(context.data.activeGeneration.generation_status, 'pending');
  assert.equal(context.data.activeGeneration.generation_total, 57);

  resolveCreate({
    id: 'sheet-id',
    generation_status: 'failed',
    generation_total: 57,
    generation_completed: 0,
    generation_error_message: '测试结束',
  });
  await Promise.all([first, second]);
});


test('generation state reports progress out of original questions', () => {
  const page = loadSheetPage();
  const context = createContext(page);

  context.applyGenerationState({
    id: 'sheet-id',
    generation_status: 'processing',
    generation_total: 57,
    generation_completed: 12,
    pdf_url: null,
  });

  assert.equal(context.data.generating, true);
  assert.equal(context.data.activeGeneration.progressText, '12/57');
  assert.equal(context.data.generationError, '');
});


test('generation state keeps the matching history item in sync', () => {
  const page = loadSheetPage();
  const context = createContext(page, {
    sheets: [{
      id: 'sheet-id',
      generation_status: 'processing',
      generation_total: 57,
      generation_completed: 12,
      pdf_url: null,
    }],
  });

  context.applyGenerationState({
    id: 'sheet-id',
    generation_status: 'completed',
    generation_total: 57,
    generation_completed: 57,
    pdf_url: '/pdfs/sheet-id.pdf',
  });

  assert.equal(context.data.sheets[0].generation_status, 'completed');
  assert.equal(context.data.sheets[0].canOpen, true);
  assert.equal(context.data.pdfUrl, '/pdfs/sheet-id.pdf');
});


test('generation polling stops when the page is hidden', async () => {
  const scheduled = [];
  const cleared = [];
  const originalSetTimeout = global.setTimeout;
  const originalClearTimeout = global.clearTimeout;
  global.setTimeout = callback => {
    scheduled.push(callback);
    return scheduled.length;
  };
  global.clearTimeout = timer => cleared.push(timer);
  const page = loadSheetPage();
  const context = createContext(page);
  context._pageVisible = true;

  try {
    context.startGenerationPolling('sheet-id');
    assert.equal(scheduled.length, 1);

    context.onHide();
    assert.deepEqual(cleared, [1]);
    assert.equal(context.generationPollingTimer, null);
  } finally {
    global.setTimeout = originalSetTimeout;
    global.clearTimeout = originalClearTimeout;
  }
});


test('onShow restores polling for an active sheet from history', async () => {
  const scheduled = [];
  const originalSetTimeout = global.setTimeout;
  global.setTimeout = callback => {
    scheduled.push(callback);
    return scheduled.length;
  };
  const page = loadSheetPage({
    listSheets: () => Promise.resolve([{
      id: 'sheet-id',
      title: '57题错题集',
      created_at: '2026-08-17T04:00:00Z',
      generation_status: 'processing',
      generation_total: 57,
      generation_completed: 12,
      pdf_url: null,
    }]),
  });
  global.wx = {
    getStorageSync: () => [],
    showToast() {},
  };
  const context = createContext(page);

  try {
    await context.onShow();
    assert.equal(context.data.activeGeneration.id, 'sheet-id');
    assert.equal(context.data.activeGeneration.progressText, '12/57');
    assert.equal(scheduled.length, 1);
  } finally {
    context.stopGenerationPolling();
    global.setTimeout = originalSetTimeout;
  }
});


test('failed generation remains visible and can be retried', async () => {
  let retriedId;
  const page = loadSheetPage({
    retrySheetGeneration: id => {
      retriedId = id;
      return Promise.resolve({
        id,
        generation_status: 'pending',
        generation_total: 57,
        generation_completed: 0,
      });
    },
  });
  global.wx = { showToast() {} };
  const context = createContext(page, {
    activeGeneration: {
      id: 'sheet-id',
      generation_status: 'failed',
      generation_error_message: '衍生题生成失败，请重试或调整为仅原题',
    },
    generationError: '衍生题生成失败，请重试或调整为仅原题',
  });
  context._pageVisible = false;

  await context.retryGeneration({ currentTarget: { dataset: { id: 'sheet-id' } } });

  assert.equal(retriedId, 'sheet-id');
  assert.equal(context.data.activeGeneration.generation_status, 'pending');
  assert.equal(context.data.generationError, '');
});


test('sheet template keeps controls visible and renders all generation states', () => {
  assert.doesNotMatch(wxml, /class="config"\s+wx:if="\{\{!generating\}\}"/);
  assert.match(wxml, /错题集已加入生成队列/);
  assert.match(wxml, /正在生成衍生题/);
  assert.match(wxml, /可离开当前页面/);
  assert.match(wxml, /重新生成/);
  assert.match(wxml, /调整配置/);
  assert.match(wxml, /wx:if="\{\{item\.generation_status === 'failed'\}\}"[^>]*bindtap="retryGeneration"[^>]*data-id="\{\{item\.id\}\}"/);
  assert.match(wxml, /disabled="\{\{item\.generation_status !== 'completed'\}\}"/);
});
