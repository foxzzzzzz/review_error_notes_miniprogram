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

test('review page loads only the active group original image on first open', () => {
  const script = read('pages/review-images/review-images.js');

  assert.doesNotMatch(script, /Promise\.all\(prepared\.map/);
  assert.match(script, /loadGroupOriginal/);
});
