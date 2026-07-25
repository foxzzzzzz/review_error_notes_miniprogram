const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');


const pagePath = path.resolve(
  __dirname,
  '..',
  'pages',
  'sheet-result',
  'result.js'
);
const apiPath = path.resolve(__dirname, '..', 'utils', 'api.js');


function loadPage(apiOverrides = {}) {
  let definition;
  delete require.cache[pagePath];
  require.cache[apiPath] = {
    id: apiPath,
    filename: apiPath,
    loaded: true,
    exports: {
      getSheetReview: () => Promise.resolve({
        sheet_id: 'sheet-1',
        title: '错题重练',
        latest_attempt: null,
        groups: [],
      }),
      createSheetAttempt: () => Promise.resolve({}),
      updateSheetAttempt: () => Promise.resolve({}),
      ...apiOverrides,
    },
  };
  global.Page = value => { definition = value; };
  require(pagePath);
  return definition;
}


function contextFor(page, values = {}) {
  const context = {
    data: { ...page.data, ...values },
    setData(next) { Object.assign(this.data, next); },
  };
  Object.keys(page).forEach(key => {
    if (typeof page[key] === 'function') context[key] = page[key];
  });
  return context;
}


test('result page loads all sheet items as correct by default', async () => {
  const page = loadPage({
    getSheetReview: () => Promise.resolve({
      sheet_id: 'sheet-1',
      title: '练习',
      latest_attempt: null,
      groups: [{
        wrong_question_id: 'question-1',
        items: [
          { sheet_item_id: 'item-1', question_text: '原题', is_correct: true },
          { sheet_item_id: 'item-2', question_text: '衍生题', is_correct: true },
        ],
      }],
    }),
  });
  const context = contextFor(page);
  global.wx = { showToast() {} };

  await page.onLoad.call(context, { sheetId: 'sheet-1' });

  assert.equal(context.data.correctCount, 2);
  assert.equal(context.data.totalCount, 2);
  assert.equal(context.data.accuracyText, '100%');
  assert.ok(context.data.idempotencyKey.includes('sheet-1'));
});


test('toggling one item updates count and accuracy', () => {
  const page = loadPage();
  const context = contextFor(page, {
    groups: [{
      items: [
        { sheetItemId: 'item-1', isCorrect: true },
        { sheetItemId: 'item-2', isCorrect: true },
      ],
    }],
    correctCount: 2,
    totalCount: 2,
  });

  page.toggleItem.call(context, {
    currentTarget: { dataset: { groupIndex: 0, itemIndex: 1 } },
  });

  assert.equal(context.data.groups[0].items[1].isCorrect, false);
  assert.equal(context.data.correctCount, 1);
  assert.equal(context.data.accuracyText, '50%');
});


test('select all restores every item to correct', () => {
  const page = loadPage();
  const context = contextFor(page, {
    groups: [{
      items: [
        { sheetItemId: 'item-1', isCorrect: false },
        { sheetItemId: 'item-2', isCorrect: true },
      ],
    }],
  });

  page.selectAll.call(context);

  assert.equal(context.data.correctCount, 2);
  assert.equal(context.data.accuracyText, '100%');
  assert.ok(context.data.groups[0].items.every(item => item.isCorrect));
});


test('duplicate submit taps reuse one idempotency key and send once', async () => {
  const calls = [];
  let resolveRequest;
  const page = loadPage({
    createSheetAttempt: (sheetId, data) => {
      calls.push({ sheetId, data });
      return new Promise(resolve => { resolveRequest = resolve; });
    },
  });
  const context = contextFor(page, {
    sheetId: 'sheet-1',
    idempotencyKey: 'sheet-1-fixed',
    groups: [{
      items: [{ sheetItemId: 'item-1', isCorrect: true }],
    }],
    totalCount: 1,
    correctCount: 1,
  });
  global.wx = { showToast() {} };

  const first = page.submit.call(context);
  const second = page.submit.call(context);

  assert.equal(calls.length, 1);
  assert.equal(calls[0].data.idempotency_key, 'sheet-1-fixed');
  resolveRequest({
    id: 'attempt-1',
    updated_at: '2026-07-25T08:00:00',
  });
  await first;
  await second;
});


test('existing latest attempt is updated with its optimistic version', async () => {
  let call;
  const page = loadPage({
    updateSheetAttempt: (sheetId, attemptId, data) => {
      call = { sheetId, attemptId, data };
      return Promise.resolve({
        id: attemptId,
        updated_at: '2026-07-25T09:00:00',
      });
    },
  });
  const context = contextFor(page, {
    sheetId: 'sheet-1',
    attemptId: 'attempt-1',
    attemptUpdatedAt: '2026-07-25T08:00:00',
    groups: [{
      items: [{ sheetItemId: 'item-1', isCorrect: false }],
    }],
    totalCount: 1,
  });
  global.wx = { showToast() {} };

  await page.submit.call(context);

  assert.deepEqual(call, {
    sheetId: 'sheet-1',
    attemptId: 'attempt-1',
    data: {
      updated_at: '2026-07-25T08:00:00',
      items: [{ sheet_item_id: 'item-1', is_correct: false }],
    },
  });
  assert.equal(context.data.attemptUpdatedAt, '2026-07-25T09:00:00');
});


test('attempt conflict reloads the latest server result', async () => {
  let reviewCalls = 0;
  const page = loadPage({
    getSheetReview: () => {
      reviewCalls += 1;
      return Promise.resolve({
        sheet_id: 'sheet-1',
        title: '练习',
        latest_attempt: {
          id: 'attempt-2',
          updated_at: '2026-07-25T10:00:00',
        },
        groups: [{
          wrong_question_id: 'question-1',
          items: [{
            sheet_item_id: 'item-1',
            question_type: 'original',
            question_text: '题目',
            is_correct: false,
          }],
        }],
      });
    },
    updateSheetAttempt: () => Promise.reject({
      statusCode: 409,
      message: '练习结果已发生变化，请刷新后重试',
    }),
  });
  const context = contextFor(page, {
    sheetId: 'sheet-1',
    attemptId: 'attempt-1',
    attemptUpdatedAt: '2026-07-25T09:00:00',
    groups: [{
      items: [{ sheetItemId: 'item-1', isCorrect: true }],
    }],
    totalCount: 1,
  });
  global.wx = { showToast() {} };

  await page.submit.call(context);

  assert.equal(reviewCalls, 1);
  assert.equal(context.data.attemptId, 'attempt-2');
  assert.equal(context.data.attemptUpdatedAt, '2026-07-25T10:00:00');
  assert.equal(context.data.groups[0].items[0].isCorrect, false);
});
