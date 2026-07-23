const api = require('../../utils/api');

const BEIJING_OFFSET_MS = 8 * 60 * 60 * 1000;
const PAGE_SIZE = 20;
const pad = value => String(value).padStart(2, '0');

const parseCreatedAt = createdAt => {
  const text = String(createdAt);
  return new Date(/(?:Z|[+-]\d{2}:?\d{2})$/i.test(text) ? text : `${text}Z`);
};

const getBeijingParts = date => {
  const beijingDate = new Date(date.getTime() + BEIJING_OFFSET_MS);
  return {
    year: beijingDate.getUTCFullYear(),
    month: beijingDate.getUTCMonth(),
    day: beijingDate.getUTCDate(),
    hour: beijingDate.getUTCHours(),
    minute: beijingDate.getUTCMinutes(),
  };
};

const formatCreatedAt = (createdAt, now = new Date()) => {
  if (!createdAt) return '';
  const createdDate = parseCreatedAt(createdAt);
  if (Number.isNaN(createdDate.getTime()) || Number.isNaN(now.getTime())) return '';

  const created = getBeijingParts(createdDate);
  const current = getBeijingParts(now);
  const createdDay = Date.UTC(created.year, created.month, created.day);
  const currentDay = Date.UTC(current.year, current.month, current.day);
  const daysAgo = (currentDay - createdDay) / (24 * 60 * 60 * 1000);
  const time = `${pad(created.hour)}:${pad(created.minute)}`;

  if (daysAgo === 0) return `今天 ${time}`;
  if (daysAgo === 1) return `昨天 ${time}`;
  if (created.year === current.year) return `${pad(created.month + 1)}-${pad(created.day)} ${time}`;
  return `${created.year}-${pad(created.month + 1)}-${pad(created.day)} ${time}`;
};

const getCreatedFrom = (days, now = new Date()) => {
  const current = getBeijingParts(now);
  const from = new Date(Date.UTC(current.year, current.month, current.day - days + 1));
  return `${from.getUTCFullYear()}-${pad(from.getUTCMonth() + 1)}-${pad(from.getUTCDate())}T00:00:00+08:00`;
};

const statusMap = {
  pending: '待处理',
  needs_review: '待确认',
  confirmed: '已确认',
  mastered: '已掌握',
};

const prepareQuestions = data => data.map(q => ({
  ...q,
  selected: false,
  createdAtText: formatCreatedAt(q.created_at),
  difficultyStars: q.difficulty ? '⭐'.repeat(q.difficulty) : '?',
  statusText: statusMap[q.status] || q.status,
}));

Page({
  data: {
    questions: [],
    filterIndex: 0,
    subject: null,
    subjectFilter: null,
    timeFilter: '',
    tag: '',
    tagFilter: '',
    loading: false,
    hasMore: true,
    offset: 0,
    subjects: ['全部', '语文', '数学', '英语'],
    selectedIds: [],
    selectedCount: 0,
    allLoadedSelected: false,
    subjectMap: { math: '数学', chinese: '语文', english: '英语' },
    subjectFilters: [
      { label: '全部', value: '' },
      { label: '语文', value: 'chinese' },
      { label: '数学', value: 'math' },
      { label: '英语', value: 'english' },
    ],
    timeFilters: [
      { label: '全部', value: '' },
      { label: '今天', value: '1' },
      { label: '近3天', value: '3' },
      { label: '近7天', value: '7' },
      { label: '近30天', value: '30' },
    ],
  },
  onShow() {
    if (this._isQuestionLoading) return Promise.resolve();

    const restoreOnError = this.data.questions.length ? {
      questions: this.data.questions,
      selectedIds: this.data.selectedIds,
      selectedCount: this.data.selectedCount,
      allLoadedSelected: this.data.allLoadedSelected,
      offset: this.data.offset,
      hasMore: this.data.hasMore,
    } : null;
    return this.load({ reset: true, restoreOnError });
  },
  load({ reset = false, restoreOnError = null } = {}) {
    if (this._isQuestionLoading) {
      if (!reset) return Promise.resolve();

      this._requestGeneration = (this._requestGeneration || 0) + 1;
      this._pendingReset = true;
      this.setData({
        questions: [],
        selectedIds: [],
        selectedCount: 0,
        allLoadedSelected: false,
        offset: 0,
        hasMore: true,
      });
      return new Promise(resolve => {
        this._pendingResetResolvers = this._pendingResetResolvers || [];
        this._pendingResetResolvers.push(resolve);
      });
    }
    if (!reset && !this.data.hasMore) return Promise.resolve();

    return this._startLoad({ reset, restoreOnError });
  },
  _startLoad({ reset, restoreOnError = null }) {

    const offset = reset ? 0 : this.data.offset;
    const requestGeneration = (this._requestGeneration || 0) + 1;
    this._requestGeneration = requestGeneration;
    this._isQuestionLoading = true;
    const params = { limit: PAGE_SIZE, offset };
    if (this.data.subjectFilter) params.subject = this.data.subjectFilter;
    if (this.data.tagFilter) params.tag = this.data.tagFilter;
    if (this.data.timeFilter) params.created_from = getCreatedFrom(Number(this.data.timeFilter));

    this.setData(reset
      ? { questions: [], selectedIds: [], selectedCount: 0, allLoadedSelected: false, offset: 0, hasMore: true, loading: true }
      : { loading: true });

    return api.listQuestions(params).then(data => {
      if (requestGeneration !== this._requestGeneration) return;

      const addedQuestions = prepareQuestions(data);
      const questions = reset ? addedQuestions : this.data.questions.concat(addedQuestions);
      this.setData({
        questions,
        selectedIds: reset ? [] : this.data.selectedIds,
        selectedCount: reset ? 0 : this.data.selectedCount,
        allLoadedSelected: reset ? false : (data.length > 0 ? false : this.data.allLoadedSelected),
        offset: offset + data.length,
        hasMore: data.length === PAGE_SIZE,
        loading: false,
      });
    }).catch(() => {
      if (requestGeneration !== this._requestGeneration) return;
      this.setData(restoreOnError ? { ...restoreOnError, loading: false } : { loading: false });
      this.showError();
    }).finally(() => {
      this._isQuestionLoading = false;
      this.setData({ loading: false });
      if (!this._pendingReset) return;

      this._pendingReset = false;
      const pendingResetResolvers = this._pendingResetResolvers || [];
      this._pendingResetResolvers = [];
      this._startLoad({ reset: true }).then(() => {
        pendingResetResolvers.forEach(resolve => resolve());
      });
    });
  },
  onFilter(e) {
    const idx = parseInt(e.detail.value);
    const subjectMap = {0: null, 1: 'chinese', 2: 'math', 3: 'english'};
    this.setData({ filterIndex: idx, subject: subjectMap[idx], subjectFilter: subjectMap[idx] });
    return this.load({ reset: true });
  },
  onSubjectFilter(e) {
    const subject = e.currentTarget.dataset.value || null;
    const filterIndex = subject ? this.data.subjectFilters.findIndex(item => item.value === subject) : 0;
    this.setData({ filterIndex, subject, subjectFilter: subject });
    return this.load({ reset: true });
  },
  onTimeFilter(e) {
    this.setData({ timeFilter: e.currentTarget.dataset.value || '' });
    return this.load({ reset: true });
  },
  onSearch(e) {
    const tag = e.detail.value;
    this.setData({ tag, tagFilter: tag });
    return this.load({ reset: true });
  },
  onReachBottom() {
    if (this.data.hasMore && !this.data.loading) return this.load({ reset: false });
    return Promise.resolve();
  },
  onDetail(e) {
    wx.navigateTo({ url: `/pages/question-detail/detail?id=${e.currentTarget.dataset.id}` });
  },
  onSelect(e) {
    const id = e.currentTarget.dataset.id;
    const qs = this.data.questions.map(q => q.id === id ? {...q, selected: !q.selected} : q);
    const selectedIds = qs.filter(q => q.selected).map(q => q.id);
    this.setData({
      questions: qs,
      selectedIds,
      selectedCount: selectedIds.length,
      allLoadedSelected: qs.length > 0 && qs.every(q => q.selected),
    });
  },
  onToggleSelectAll() {
    const shouldSelectAll = !this.data.allLoadedSelected;
    const questions = this.data.questions.map(q => ({ ...q, selected: shouldSelectAll }));
    const selectedIds = shouldSelectAll ? questions.map(q => q.id) : [];
    this.setData({
      questions,
      selectedIds,
      selectedCount: selectedIds.length,
      allLoadedSelected: shouldSelectAll && questions.length > 0,
    });
  },
  goToSheet() {
    wx.setStorageSync('selectedIds', this.data.selectedIds);
    wx.switchTab({ url: '/pages/sheet/sheet' });
  },
  showError() {
    wx.showToast({ title: '加载失败，请重试', icon: 'none' });
  },
});

module.exports = { formatCreatedAt, getCreatedFrom };
