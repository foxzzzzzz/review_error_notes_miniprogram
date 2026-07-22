const api = require('../../utils/api');
Page({
  data: { question: {}, reviewInfo: null, subjects: ['数学','语文','英语'], subjectIndex: 0 },
  onLoad(options) {
    return api.getQuestion(options.id).then(q => {
      const subjectIndex = ['math','chinese','english'].indexOf(q.subject);
      const raw = q.ocr_raw_json || {};
      const confidenceText = typeof raw.confidence === 'number'
        ? `${Math.round(raw.confidence * 100)}%`
        : '未提供';
      this.setData({
        question: { ...q, image_url: api.resolveServerUrl(q.image_url) },
        reviewInfo: {
          normalizedText: raw.normalized_text || '',
          answer: q.ocr_answer || raw.answer || '',
          confidenceText,
          uncertainSegments: raw.uncertain_segments || [],
        },
        subjectIndex: subjectIndex < 0 ? 0 : subjectIndex,
      });
    }).catch(() => wx.showToast({ title: '加载失败', icon: 'none' }));
  },
  save() {
    api.updateQuestion(this.data.question.id, this.data.question)
      .then(() => wx.navigateBack())
      .catch(() => wx.showToast({ title: '保存失败', icon: 'none' }));
  },
  remove() {
    wx.showModal({ title: '确认删除', success: (r) => {
      if (r.confirm) {
        api.deleteQuestion(this.data.question.id)
          .then(() => wx.navigateBack())
          .catch(() => wx.showToast({ title: '删除失败', icon: 'none' }));
      }
    }});
  },
  onTextInput(e) { this.setData({ 'question.ocr_text': e.detail.value }); },
  addTag(e) { this.setData({ 'question.tags': [...(this.data.question.tags || []), e.detail.value] }); },
  onSubjectChange(e) {
    const idx = parseInt(e.detail.value);
    this.setData({ subjectIndex: idx, 'question.subject': ['math','chinese','english'][idx] });
  },
  onDifficulty(e) {
    this.setData({ 'question.difficulty': e.detail.value });
  },
});
