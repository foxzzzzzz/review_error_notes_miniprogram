const api = require('../../utils/api');
Page({
  data: { question: {}, subjects: ['数学','语文','英语'], subjectIndex: 0 },
  onLoad(options) {
    api.listQuestions().then(data => {
      const q = data.find(q => q.id === options.id) || {};
      this.setData({ question: q, subjectIndex: ['math','chinese','english'].indexOf(q.subject) });
    });
  },
  save() { api.updateQuestion(this.data.question.id, this.data.question).then(() => wx.navigateBack()); },
  remove() {
    wx.showModal({ title: '确认删除', success: (r) => {
      if (r.confirm) api.deleteQuestion(this.data.question.id).then(() => wx.navigateBack());
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
