const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');

test('all configured tab bar icons exist', () => {
  const app = JSON.parse(fs.readFileSync(path.join(root, 'app.json'), 'utf8'));
  const iconPaths = app.tabBar.list.flatMap(item =>
    [item.iconPath, item.selectedIconPath].filter(Boolean)
  );

  const missing = iconPaths.filter(item => !fs.existsSync(path.join(root, item)));
  assert.deepEqual(missing, []);
});

test('absolute local image sources in WXML exist', () => {
  const files = fs.readdirSync(path.join(root, 'pages'), { recursive: true })
    .filter(file => file.endsWith('.wxml'));
  const missing = [];

  for (const file of files) {
    const content = fs.readFileSync(path.join(root, 'pages', file), 'utf8');
    for (const match of content.matchAll(/src="(\/[^"]+)"/g)) {
      const resource = match[1].slice(1);
      if (!fs.existsSync(path.join(root, resource))) missing.push(resource);
    }
  }

  assert.deepEqual(missing, []);
});
