const api = require('../../utils/api');
Page({
  data: {
    questions: [],
    filterIndex: 0,
    subjects: ['全部', '数学', '语文', '英语'],
    selectedIds: [],
    selectedCount: 0,
    subjectMap: { math: '数学', chinese: '语文', english: '英语' },
  },
  onShow() { this.load(); },
  load() {
    api.listQuestions().then(data => {
      const questions = data.map(q => ({...q, selected: false}));
      this.setData({ questions, selectedIds: [], selectedCount: 0 });
    });
  },
  onFilter(e) {
    const idx = parseInt(e.detail.value);
    this.setData({ filterIndex: idx });
    const subjectMap = {0: null, 1: 'math', 2: 'chinese', 3: 'english'};
    api.listQuestions({ subject: subjectMap[idx] }).then(data =>
      this.setData({ questions: data.map(q => ({...q, selected: false})), selectedIds: [], selectedCount: 0 }));
  },
  onSearch(e) {
    api.listQuestions({ tag: e.detail.value }).then(data =>
      this.setData({ questions: data.map(q => ({...q, selected: false})), selectedIds: [], selectedCount: 0 }));
  },
  onDetail(e) {
    wx.navigateTo({ url: `/pages/question-detail/detail?id=${e.currentTarget.dataset.id}` });
  },
  onSelect(e) {
    const id = e.currentTarget.dataset.id;
    const qs = this.data.questions.map(q => q.id === id ? {...q, selected: !q.selected} : q);
    const selectedIds = qs.filter(q => q.selected).map(q => q.id);
    this.setData({ questions: qs, selectedIds, selectedCount: selectedIds.length });
  },
  goToSheet() {
    wx.setStorageSync('selectedIds', this.data.selectedIds);
    wx.switchTab({ url: '/pages/sheet/sheet' });
  },
});
