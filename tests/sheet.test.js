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
      resolveServerUrl: value => value,
      ...apiOverrides,
    },
  };
  global.Page = value => { definition = value; };
  require(sheetPath);
  return definition;
}


test('sheet defaults to originals only', () => {
  assert.match(js, /derivedCount:\s*0/);
  assert.match(wxml, /<radio value="0" checked="\{\{derivedCount === 0\}\}"\s*\/>/);
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
  const context = {
    data: { ...page.data, selectedIds: ['question-id'] },
    setData(values) { Object.assign(this.data, values); },
  };

  page.generate.call(context);
  await new Promise(resolve => setImmediate(resolve));

  assert.equal(request.derived_per_original, 0);
});


test('generate shows the actionable backend error', async () => {
  let toast;
  const page = loadSheetPage({
    createSheet: () => Promise.reject(new Error('请重新上传图片识别后再出卷')),
  });
  global.wx = { showToast(options) { toast = options; } };
  const context = {
    data: { ...page.data, selectedIds: ['question-id'] },
    setData(values) { Object.assign(this.data, values); },
  };

  page.generate.call(context);
  await new Promise(resolve => setImmediate(resolve));

  assert.equal(toast.title, '请重新上传图片识别后再出卷');
  assert.equal(toast.icon, 'none');
});
