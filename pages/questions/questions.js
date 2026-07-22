const api = require('../../utils/api');

const statusMap = {
  pending: '待处理',
  needs_review: '待确认',
  confirmed: '已确认',
  mastered: '已掌握',
};

const prepareQuestions = data => data.map(q => ({
  ...q,
  selected: false,
  difficultyStars: q.difficulty ? '⭐'.repeat(q.difficulty) : '?',
  statusText: statusMap[q.status] || q.status,
}));

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
      const questions = prepareQuestions(data);
      this.setData({ questions, selectedIds: [], selectedCount: 0 });
    }).catch(() => this.showError());
  },
  onFilter(e) {
    const idx = parseInt(e.detail.value);
    this.setData({ filterIndex: idx });
    const subjectMap = {0: null, 1: 'math', 2: 'chinese', 3: 'english'};
    api.listQuestions({ subject: subjectMap[idx] }).then(data =>
      this.setData({ questions: prepareQuestions(data), selectedIds: [], selectedCount: 0 }))
      .catch(() => this.showError());
  },
  onSearch(e) {
    api.listQuestions({ tag: e.detail.value }).then(data =>
      this.setData({ questions: prepareQuestions(data), selectedIds: [], selectedCount: 0 }))
      .catch(() => this.showError());
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
  showError() {
    wx.showToast({ title: '加载失败', icon: 'none' });
  },
});
