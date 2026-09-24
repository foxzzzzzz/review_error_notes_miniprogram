const clamp = value => Math.max(0, Math.min(1, value));

const normalizedPoint = (x, y, displayedWidth, displayedHeight) => {
  if (!(displayedWidth > 0) || !(displayedHeight > 0)) return null;
  return { x: clamp(x / displayedWidth), y: clamp(y / displayedHeight) };
};

const normalizedPointFromRect = (clientX, clientY, rect) => {
  if (!rect || !(rect.width > 0) || !(rect.height > 0)) return null;
  return normalizedPoint(clientX - rect.left, clientY - rect.top, rect.width, rect.height);
};

const bboxFromPoints = (first, second) => {
  if (!first || !second) return null;
  const bbox = [
    Math.min(first.x, second.x),
    Math.min(first.y, second.y),
    Math.max(first.x, second.x),
    Math.max(first.y, second.y),
  ];
  return bbox[2] - bbox[0] >= 0.01 && bbox[3] - bbox[1] >= 0.01 ? bbox : null;
};

const REVIEW_FIELDS = ['instruction', 'prompt_text', 'question_type', 'correct_answer'];
const QUESTION_TYPES = [
  { value: 'write_pinyin', label: '写拼音' },
  { value: 'write_word', label: '写词语' },
  { value: 'fill_blank', label: '填空' },
  { value: 'calculation', label: '计算' },
  { value: 'other', label: '其他' },
];
const questionTypeIndex = value => {
  return QUESTION_TYPES.findIndex(item => item.value === value);
};

const hasCompleteReviewFields = question => REVIEW_FIELDS.every(field => (
  String((question.review_fields || {})[field] || '').trim()
)) && QUESTION_TYPES.some(item => item.value === question.review_fields.question_type);

const buildDecisionPayload = questions => questions.map(question => ({
  question_id: question.id,
  decision: question.decision,
  ...(question.decision === 'collect' ? question.review_fields : {}),
}));

const buildManualQuestionPayload = (questionId, bbox, fields) => ({
  question_id: questionId,
  bbox,
  instruction: fields.instruction.trim(),
  prompt_text: fields.prompt_text.trim(),
  question_type: fields.question_type.trim(),
  correct_answer: fields.correct_answer.trim(),
  ...(String(fields.student_answer || '').trim()
    ? { student_answer: fields.student_answer.trim() }
    : {}),
});

module.exports = {
  normalizedPoint,
  normalizedPointFromRect,
  bboxFromPoints,
  hasCompleteReviewFields,
  buildDecisionPayload,
  buildManualQuestionPayload,
  QUESTION_TYPES,
  questionTypeIndex,
};
