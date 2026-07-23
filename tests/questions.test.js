const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const apiPath = path.join(root, 'utils', 'api.js');
const pagePath = path.join(root, 'pages', 'questions', 'questions.js');

test('questions page formats created_at in fixed Beijing time', () => {
  let pageDefinition;
  global.Page = definition => { pageDefinition = definition; };
  delete require.cache[pagePath];

  try {
    const { formatCreatedAt, getCreatedFrom } = require(pagePath);
    const now = new Date('2026-07-23T04:00:00Z');

    assert.equal(formatCreatedAt('2026-07-23T02:35:00Z', now), '今天 10:35');
    assert.equal(formatCreatedAt('2026-07-23T02:35:00', now), '今天 10:35');
    assert.equal(formatCreatedAt('2026-07-22T08:20:00Z', now), '昨天 16:20');
    assert.equal(formatCreatedAt('2026-07-20T01:15:00Z', now), '07-20 09:15');
    assert.equal(formatCreatedAt('2025-12-30T01:15:00Z', now), '2025-12-30 09:15');
    assert.equal(getCreatedFrom(3, now), '2026-07-21T00:00:00+08:00');
  } finally {
    delete global.Page;
    delete require.cache[pagePath];
  }
});

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

test('questions page loads twenty-item pages and stops after a short page', async () => {
  const api = require(apiPath);
  const originalListQuestions = api.listQuestions;
  const requests = [];
  const resolvers = [];
  let pageDefinition;

  api.listQuestions = params => {
    requests.push(params);
    return new Promise(resolve => resolvers.push(resolve));
  };
  global.Page = definition => { pageDefinition = definition; };
  delete require.cache[pagePath];
  require(pagePath);

  const page = {
    ...pageDefinition,
    data: { ...pageDefinition.data },
    setData(values) { Object.assign(this.data, values); },
  };

  try {
    const firstLoad = page.load({ reset: true });
    assert.deepEqual(requests[0], { limit: 20, offset: 0 });
    resolvers[0](Array.from({ length: 20 }, (_, id) => ({ id })));
    await firstLoad;

    assert.equal(page.data.questions.length, 20);
    assert.equal(page.data.offset, 20);
    assert.equal(page.data.hasMore, true);

    const secondLoad = page.onReachBottom();
    assert.deepEqual(requests[1], { limit: 20, offset: 20 });
    resolvers[1](Array.from({ length: 5 }, (_, index) => ({ id: 20 + index })));
    await secondLoad;

    assert.equal(page.data.questions.length, 25);
    assert.equal(page.data.questions[20].selected, false);
    assert.equal(page.data.offset, 25);
    assert.equal(page.data.hasMore, false);

    await page.onReachBottom();
    assert.equal(requests.length, 2);
  } finally {
    api.listQuestions = originalListQuestions;
    delete global.Page;
    delete require.cache[pagePath];
  }
});

test('questions page ignores a response from before a filter reset', async () => {
  const api = require(apiPath);
  const originalListQuestions = api.listQuestions;
  const resolvers = [];
  let pageDefinition;

  api.listQuestions = () => new Promise(resolve => resolvers.push(resolve));
  global.Page = definition => { pageDefinition = definition; };
  delete require.cache[pagePath];
  require(pagePath);

  const page = {
    ...pageDefinition,
    data: { ...pageDefinition.data },
    setData(values) { Object.assign(this.data, values); },
  };

  try {
    const initialLoad = page.load({ reset: true });
    const filteredLoad = page.onFilter({ detail: { value: '2' } });
    assert.equal(typeof filteredLoad.then, 'function');

    resolvers[0]([{ id: 'old' }]);
    await initialLoad;
    resolvers[1]([{ id: 'new', subject: 'math' }]);
    await filteredLoad;

    assert.deepEqual(page.data.questions.map(question => question.id), ['new']);
    assert.equal(page.data.selectedCount, 0);
  } finally {
    api.listQuestions = originalListQuestions;
    delete global.Page;
    delete require.cache[pagePath];
  }
});

test('questions page coalesces resets until the active request settles', async () => {
  const api = require(apiPath);
  const originalListQuestions = api.listQuestions;
  const requests = [];
  const resolvers = [];
  let pageDefinition;

  api.listQuestions = params => {
    requests.push(params);
    return new Promise(resolve => resolvers.push(resolve));
  };
  global.Page = definition => { pageDefinition = definition; };
  delete require.cache[pagePath];
  require(pagePath);

  const page = {
    ...pageDefinition,
    data: {
      ...pageDefinition.data,
      questions: [{ id: 'selected', selected: true }],
      selectedIds: ['selected'],
      selectedCount: 1,
      offset: 20,
      hasMore: true,
    },
    setData(values) { Object.assign(this.data, values); },
  };

  try {
    const initialLoad = page.load({ reset: false });
    const mathLoad = page.onFilter({ detail: { value: '2' } });
    const chineseLoad = page.onFilter({ detail: { value: '1' } });

    assert.equal(requests.length, 1);
    assert.deepEqual(page.data.questions, []);
    assert.deepEqual(page.data.selectedIds, []);
    assert.equal(page.data.selectedCount, 0);
    assert.equal(page.data.offset, 0);
    assert.equal(page.data.hasMore, true);
    assert.equal(page.data.loading, true);
    resolvers[0]([{ id: 'stale' }]);
    await initialLoad;

    assert.equal(requests.length, 2);
    assert.deepEqual(requests[1], { limit: 20, offset: 0, subject: 'chinese' });
    resolvers[1]([{ id: 'current', subject: 'chinese' }]);
    await Promise.all([mathLoad, chineseLoad]);

    assert.deepEqual(page.data.questions.map(question => question.id), ['current']);
  } finally {
    api.listQuestions = originalListQuestions;
    delete global.Page;
    delete require.cache[pagePath];
  }
});

test('questions page suppresses stale request errors before starting the queued reset', async () => {
  const api = require(apiPath);
  const originalListQuestions = api.listQuestions;
  const resolvers = [];
  const rejected = [];
  const toasts = [];
  let pageDefinition;

  api.listQuestions = () => new Promise((resolve, reject) => resolvers.push({ resolve, reject }));
  global.wx = { showToast: toast => toasts.push(toast) };
  global.Page = definition => { pageDefinition = definition; };
  delete require.cache[pagePath];
  require(pagePath);

  const page = {
    ...pageDefinition,
    data: { ...pageDefinition.data },
    setData(values) { Object.assign(this.data, values); },
  };

  try {
    const initialLoad = page.load({ reset: true });
    const queuedLoad = page.onFilter({ detail: { value: '2' } });
    assert.equal(resolvers.length, 1);
    resolvers[0].reject(new Error('stale request failed'));
    await initialLoad.catch(error => rejected.push(error));

    assert.deepEqual(rejected, []);
    assert.equal(toasts.length, 0);
    assert.equal(resolvers.length, 2);

    resolvers[1].resolve([{ id: 'current', subject: 'math' }]);
    await queuedLoad;
    assert.deepEqual(page.data.questions.map(question => question.id), ['current']);
  } finally {
    api.listQuestions = originalListQuestions;
    delete global.wx;
    delete global.Page;
    delete require.cache[pagePath];
  }
});

test('questions page keeps pagination state after an effective request fails', async () => {
  const api = require(apiPath);
  const originalListQuestions = api.listQuestions;
  const toasts = [];
  let rejectRequest;
  let pageDefinition;

  api.listQuestions = () => new Promise((_resolve, reject) => { rejectRequest = reject; });
  global.wx = { showToast: toast => toasts.push(toast) };
  global.Page = definition => { pageDefinition = definition; };
  delete require.cache[pagePath];
  require(pagePath);

  const page = {
    ...pageDefinition,
    data: { ...pageDefinition.data, questions: [{ id: 'existing' }], offset: 20, hasMore: true },
    setData(values) { Object.assign(this.data, values); },
  };

  try {
    const load = page.load({ reset: false });
    rejectRequest(new Error('request failed'));
    await load;

    assert.equal(page.data.loading, false);
    assert.equal(page.data.offset, 20);
    assert.equal(page.data.hasMore, true);
    assert.deepEqual(page.data.questions.map(question => question.id), ['existing']);
    assert.equal(toasts.length, 1);
    assert.equal(toasts[0].title, '加载失败，请重试');
  } finally {
    api.listQuestions = originalListQuestions;
    delete global.wx;
    delete global.Page;
    delete require.cache[pagePath];
  }
});

test('questions page formatter safely handles invalid input and Beijing calendar boundaries', () => {
  global.Page = () => {};
  delete require.cache[pagePath];

  try {
    const { formatCreatedAt } = require(pagePath);

    assert.equal(formatCreatedAt('', new Date('2026-07-23T04:00:00Z')), '');
    assert.equal(formatCreatedAt(null, new Date('2026-07-23T04:00:00Z')), '');
    assert.equal(formatCreatedAt('2026-07-23T16:00:00Z', new Date('2026-07-23T16:10:00Z')), '今天 00:00');
    assert.equal(formatCreatedAt('2026-12-31T15:59:00Z', new Date('2027-01-01T00:10:00Z')), '昨天 23:59');
  } finally {
    delete global.Page;
    delete require.cache[pagePath];
  }
});

test('questions page combines subject, tag, and time filters in one request', async () => {
  const api = require(apiPath);
  const originalListQuestions = api.listQuestions;
  const requests = [];
  let pageDefinition;

  api.listQuestions = params => {
    requests.push(params);
    return Promise.resolve([]);
  };
  global.Page = definition => { pageDefinition = definition; };
  delete require.cache[pagePath];
  require(pagePath);

  const page = {
    ...pageDefinition,
    data: { ...pageDefinition.data },
    setData(values) { Object.assign(this.data, values); },
  };

  try {
    const { getCreatedFrom } = require(pagePath);
    await page.onSubjectFilter({ currentTarget: { dataset: { value: 'math' } } });
    await page.onSearch({ detail: { value: 'geometry' } });
    const createdFromBefore = getCreatedFrom(3);
    await page.onTimeFilter({ currentTarget: { dataset: { value: '3' } } });
    const createdFromAfter = getCreatedFrom(3);
    const { created_from: actualCreatedFrom, ...requestWithoutCreatedFrom } = requests[2];

    assert.deepEqual(requestWithoutCreatedFrom, {
      limit: 20,
      offset: 0,
      subject: 'math',
      tag: 'geometry',
    });
    assert.ok([createdFromBefore, createdFromAfter].includes(actualCreatedFrom));
  } finally {
    api.listQuestions = originalListQuestions;
    delete global.Page;
    delete require.cache[pagePath];
  }
});

test('questions page selects and deselects only the currently loaded questions', () => {
  let pageDefinition;
  global.Page = definition => { pageDefinition = definition; };
  delete require.cache[pagePath];
  require(pagePath);

  const page = {
    ...pageDefinition,
    data: {
      ...pageDefinition.data,
      questions: [{ id: 'one', selected: false }, { id: 'two', selected: false }],
    },
    setData(values) { Object.assign(this.data, values); },
  };

  try {
    page.onToggleSelectAll();
    assert.deepEqual(page.data.selectedIds, ['one', 'two']);
    assert.equal(page.data.selectedCount, 2);
    assert.equal(page.data.allLoadedSelected, true);

    page.onToggleSelectAll();
    assert.deepEqual(page.data.selectedIds, []);
    assert.equal(page.data.selectedCount, 0);
    assert.equal(page.data.allLoadedSelected, false);
  } finally {
    delete global.Page;
    delete require.cache[pagePath];
  }
});

test('questions page marks allLoadedSelected after every loaded question is selected individually', () => {
  let pageDefinition;
  global.Page = definition => { pageDefinition = definition; };
  delete require.cache[pagePath];
  require(pagePath);

  const page = {
    ...pageDefinition,
    data: {
      ...pageDefinition.data,
      questions: [{ id: 'one', selected: false }, { id: 'two', selected: false }],
    },
    setData(values) { Object.assign(this.data, values); },
  };

  try {
    page.onSelect({ currentTarget: { dataset: { id: 'one' } } });
    assert.equal(page.data.allLoadedSelected, false);
    page.onSelect({ currentTarget: { dataset: { id: 'two' } } });

    assert.deepEqual(page.data.selectedIds, ['one', 'two']);
    assert.equal(page.data.selectedCount, 2);
    assert.equal(page.data.allLoadedSelected, true);
  } finally {
    delete global.Page;
    delete require.cache[pagePath];
  }
});

test('questions page keeps all-loaded selection when an appended page is empty', async () => {
  const api = require(apiPath);
  const originalListQuestions = api.listQuestions;
  const resolvers = [];
  let pageDefinition;

  api.listQuestions = () => new Promise(resolve => resolvers.push(resolve));
  global.Page = definition => { pageDefinition = definition; };
  delete require.cache[pagePath];
  require(pagePath);

  const page = {
    ...pageDefinition,
    data: { ...pageDefinition.data },
    setData(values) { Object.assign(this.data, values); },
  };

  try {
    const firstLoad = page.load({ reset: true });
    resolvers[0](Array.from({ length: 20 }, (_, index) => ({ id: `seed-${index}` })));
    await firstLoad;
    page.onToggleSelectAll();

    const nextLoad = page.load({ reset: false });
    resolvers[1]([]);
    await nextLoad;

    assert.equal(page.data.selectedIds.length, 20);
    assert.equal(page.data.allLoadedSelected, true);
  } finally {
    api.listQuestions = originalListQuestions;
    delete global.Page;
    delete require.cache[pagePath];
  }
});

test('questions page keeps allLoadedSelected false when selecting an empty list', () => {
  let pageDefinition;
  global.Page = definition => { pageDefinition = definition; };
  delete require.cache[pagePath];
  require(pagePath);

  const page = {
    ...pageDefinition,
    data: { ...pageDefinition.data, allLoadedSelected: false },
    setData(values) { Object.assign(this.data, values); },
  };

  try {
    page.onToggleSelectAll();
    assert.deepEqual(page.data.selectedIds, []);
    assert.equal(page.data.selectedCount, 0);
    assert.equal(page.data.allLoadedSelected, false);
  } finally {
    delete global.Page;
    delete require.cache[pagePath];
  }
});

test('questions page clears selections immediately when onShow resets the list', async () => {
  const api = require(apiPath);
  const originalListQuestions = api.listQuestions;
  let resolveRequest;
  let pageDefinition;

  api.listQuestions = () => new Promise(resolve => { resolveRequest = resolve; });
  global.Page = definition => { pageDefinition = definition; };
  delete require.cache[pagePath];
  require(pagePath);

  const page = {
    ...pageDefinition,
    data: {
      ...pageDefinition.data,
      questions: [{ id: 'selected', selected: true }],
      selectedIds: ['selected'],
      selectedCount: 1,
      allLoadedSelected: true,
      offset: 20,
    },
    setData(values) { Object.assign(this.data, values); },
  };

  try {
    const load = page.onShow();
    assert.deepEqual(page.data.questions, []);
    assert.deepEqual(page.data.selectedIds, []);
    assert.equal(page.data.selectedCount, 0);
    assert.equal(page.data.allLoadedSelected, false);
    assert.equal(page.data.offset, 0);

    resolveRequest([{ id: 'fresh' }]);
    await load;
    assert.deepEqual(page.data.questions.map(question => question.id), ['fresh']);
    assert.deepEqual(page.data.selectedIds, []);
    assert.equal(page.data.selectedCount, 0);
    assert.equal(page.data.allLoadedSelected, false);
  } finally {
    api.listQuestions = originalListQuestions;
    delete global.Page;
    delete require.cache[pagePath];
  }
});

test('questions page restores loaded content when an onShow refresh fails', async () => {
  const api = require(apiPath);
  const originalListQuestions = api.listQuestions;
  const toasts = [];
  let rejectRequest;
  let pageDefinition;

  api.listQuestions = () => new Promise((_resolve, reject) => { rejectRequest = reject; });
  global.wx = { showToast: toast => toasts.push(toast) };
  global.Page = definition => { pageDefinition = definition; };
  delete require.cache[pagePath];
  require(pagePath);

  const savedQuestions = [{ id: 'saved', selected: true }];
  const page = {
    ...pageDefinition,
    data: {
      ...pageDefinition.data,
      questions: savedQuestions,
      selectedIds: ['saved'],
      selectedCount: 1,
      allLoadedSelected: true,
      offset: 20,
      hasMore: false,
    },
    setData(values) { Object.assign(this.data, values); },
  };

  try {
    const refresh = page.onShow();
    rejectRequest(new Error('refresh failed'));
    await refresh;

    assert.deepEqual(page.data.questions, savedQuestions);
    assert.deepEqual(page.data.selectedIds, ['saved']);
    assert.equal(page.data.selectedCount, 1);
    assert.equal(page.data.allLoadedSelected, true);
    assert.equal(page.data.offset, 20);
    assert.equal(page.data.hasMore, false);
    assert.equal(page.data.loading, false);
    assert.equal(toasts[0].title, '加载失败，请重试');
  } finally {
    api.listQuestions = originalListQuestions;
    delete global.wx;
    delete global.Page;
    delete require.cache[pagePath];
  }
});

test('questions page does not queue a reset when onShow runs during an active request', () => {
  const api = require(apiPath);
  const originalListQuestions = api.listQuestions;
  let pageDefinition;

  api.listQuestions = () => new Promise(() => {});
  global.Page = definition => { pageDefinition = definition; };
  delete require.cache[pagePath];
  require(pagePath);

  const page = {
    ...pageDefinition,
    data: { ...pageDefinition.data },
    setData(values) { Object.assign(this.data, values); },
  };

  try {
    page.load({ reset: false });
    page.onShow();
    assert.equal(page._pendingReset, undefined);
    assert.equal(page._requestGeneration, 1);
  } finally {
    api.listQuestions = originalListQuestions;
    delete global.Page;
    delete require.cache[pagePath];
  }
});

test('questions page keeps picker subject order aligned with its filter mapping', async () => {
  const api = require(apiPath);
  const originalListQuestions = api.listQuestions;
  const requests = [];
  let pageDefinition;

  api.listQuestions = params => {
    requests.push(params);
    return Promise.resolve([]);
  };
  global.Page = definition => { pageDefinition = definition; };
  delete require.cache[pagePath];
  require(pagePath);

  const page = {
    ...pageDefinition,
    data: { ...pageDefinition.data },
    setData(values) { Object.assign(this.data, values); },
  };

  try {
    assert.deepEqual(page.data.subjects, ['全部', '语文', '数学', '英语']);
    assert.deepEqual(page.data.subjectFilters.map(item => item.value), ['', 'chinese', 'math', 'english']);
    await page.onFilter({ detail: { value: '1' } });
    assert.deepEqual(requests[0], { limit: 20, offset: 0, subject: 'chinese' });
  } finally {
    api.listQuestions = originalListQuestions;
    delete global.Page;
    delete require.cache[pagePath];
  }
});

test('questions page preserves prior selections but clears all-loaded state when a page is appended', async () => {
  const api = require(apiPath);
  const originalListQuestions = api.listQuestions;
  const resolvers = [];
  let pageDefinition;

  api.listQuestions = () => new Promise(resolve => resolvers.push(resolve));
  global.Page = definition => { pageDefinition = definition; };
  delete require.cache[pagePath];
  require(pagePath);

  const page = {
    ...pageDefinition,
    data: { ...pageDefinition.data },
    setData(values) { Object.assign(this.data, values); },
  };

  try {
    const firstLoad = page.load({ reset: true });
    resolvers[0](Array.from({ length: 20 }, (_, index) => ({ id: index === 0 ? 'one' : index === 1 ? 'two' : `seed-${index}` })));
    await firstLoad;
    page.onToggleSelectAll();

    const nextLoad = page.load({ reset: false });
    resolvers[1]([{ id: 'three' }]);
    await nextLoad;

    assert.equal(page.data.selectedIds.length, 20);
    assert.equal(page.data.selectedIds.includes('one'), true);
    assert.equal(page.data.selectedIds.includes('two'), true);
    assert.equal(page.data.questions[20].selected, false);
    assert.equal(page.data.allLoadedSelected, false);
  } finally {
    api.listQuestions = originalListQuestions;
    delete global.Page;
    delete require.cache[pagePath];
  }
});

test('questions page template provides horizontal filter rows, selection tools, time, and list states', () => {
  const template = fs.readFileSync(
    path.join(root, 'pages', 'questions', 'questions.wxml'),
    'utf8'
  );

  assert.match(template, /bindconfirm="onSearch"/);
  assert.match(template, /scroll-x/);
  assert.match(template, /class="selection-tools"/);
  assert.match(template, /<button[^>]*bindtap="onToggleSelectAll"[^>]*>/);
  assert.match(template, /item\.createdAtText/);
  assert.match(template, /已加载\{\{questions\.length\}\}条/);
  assert.match(template, /加载中/);
  assert.match(template, /没有符合条件的错题/);
  assert.match(template, /已加载全部错题/);
});
