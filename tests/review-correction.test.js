const test = require('node:test');
const assert = require('node:assert/strict');
const {
  normalizedPoint,
  normalizedPointFromRect,
  bboxFromPoints,
  hasCompleteReviewFields,
  buildDecisionPayload,
  buildManualQuestionPayload,
  QUESTION_TYPES,
  questionTypeIndex,
} = require('../utils/review-correction');

test('selector taps convert from displayed long-image coordinates to normalized points', () => {
  assert.deepEqual(normalizedPoint(100, 600, 400, 1600), { x: 0.25, y: 0.375 });
  assert.deepEqual(normalizedPoint(-4, 1800, 400, 1600), { x: 0, y: 1 });
  assert.equal(normalizedPoint(1, 1, 0, 100), null);
  assert.deepEqual(normalizedPointFromRect(150, 80, { left: 50, top: -120, width: 400, height: 1600 }), { x: 0.25, y: 0.125 });
  assert.deepEqual(bboxFromPoints({ x: 0.7, y: 0.8 }, { x: 0.2, y: 0.3 }), [0.2, 0.3, 0.7, 0.8]);
  assert.equal(bboxFromPoints({ x: 0.2, y: 0.3 }, { x: 0.205, y: 0.8 }), null);
});

test('collect decisions require human-confirmed fields and send them with the decision', () => {
  const collect = {
    id: 'candidate-1', decision: 'collect',
    review_fields: {
      instruction: '看拼音写词语', prompt_text: 'bīng kuài',
      question_type: 'write_word', correct_answer: '冰块',
    },
  };
  const ignore = { id: 'candidate-2', decision: 'ignore', review_fields: {} };

  assert.equal(hasCompleteReviewFields(collect), true);
  assert.equal(hasCompleteReviewFields({ ...collect, review_fields: { ...collect.review_fields, correct_answer: ' ' } }), false);
  assert.equal(hasCompleteReviewFields({ ...collect, review_fields: { ...collect.review_fields, question_type: 'unknown' } }), false);
  assert.deepEqual(buildDecisionPayload([collect, ignore]), [
    { question_id: 'candidate-1', decision: 'collect', ...collect.review_fields },
    { question_id: 'candidate-2', decision: 'ignore' },
  ]);
});

test('manual-question request uses normalized bbox and keeps student answer optional', () => {
  assert.deepEqual(buildManualQuestionPayload('client-uuid', [0.1, 0.2, 0.5, 0.6], {
    instruction: ' 看拼音写词语 ', prompt_text: ' bīng kuài ',
    question_type: ' write_word ', correct_answer: ' 冰块 ', student_answer: '',
  }), {
    question_id: 'client-uuid', bbox: [0.1, 0.2, 0.5, 0.6],
    instruction: '看拼音写词语', prompt_text: 'bīng kuài',
    question_type: 'write_word', correct_answer: '冰块',
  });
});

test('question type picker shows family-friendly labels while preserving API enum values', () => {
  assert.deepEqual(QUESTION_TYPES.map(item => item.label), ['写拼音', '写词语', '填空', '计算', '其他']);
  assert.equal(QUESTION_TYPES[questionTypeIndex('write_word')].value, 'write_word');
  assert.equal(questionTypeIndex('unknown'), -1);
});
