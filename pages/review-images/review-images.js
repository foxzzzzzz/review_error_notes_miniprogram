const api = require('../../utils/api');

Page({
  data: {
    groups: [],
    currentGroup: null,
    activeIndex: 0,
    originalImagePath: '',
    loading: true,
    saving: false,
  },
  onLoad(options) {
    this.preferredImageId = options.imageId || '';
    return this.loadGroups();
  },
  loadGroups() {
    this.setData({ loading: true });
    return api.listReviewImages().then(groups => {
      const prepared = groups.map(group => ({
        ...group,
        questions: group.questions.map(question => ({
          ...question,
          decision: '',
          cropImagePath: '',
          cropLoading: false,
        })),
      }));
      const preferredIndex = prepared.findIndex(group => group.image_id === this.preferredImageId);
      this.setData({ groups: prepared, loading: false });
      return this.selectGroup(preferredIndex >= 0 ? preferredIndex : 0);
    }).catch(() => {
      this.setData({ loading: false });
      wx.showToast({ title: '待确认题目加载失败', icon: 'none' });
    });
  },
  selectGroup(index) {
    const group = this.data.groups[index];
    if (!group) {
      this.setData({ currentGroup: null, originalImagePath: '' });
      return Promise.resolve();
    }
    this.setData({ activeIndex: index, currentGroup: group, originalImagePath: '' });
    return api.downloadQuestionImage(group.questions[0].id, 'original')
      .then(originalImagePath => this.setData({ originalImagePath }))
      .catch(() => this.setData({ originalImagePath: '' }));
  },
  onGroupTap(e) {
    return this.selectGroup(Number(e.currentTarget.dataset.index));
  },
  previewOriginal() {
    const group = this.data.currentGroup;
    if (!group || !group.questions.length) return Promise.resolve();
    if (this.data.originalImagePath) {
      wx.previewImage({ current: this.data.originalImagePath, urls: [this.data.originalImagePath] });
      return Promise.resolve();
    }
    return api.downloadQuestionImage(group.questions[0].id, 'original').then(path => {
      this.setData({ originalImagePath: path });
      wx.previewImage({ current: path, urls: [path] });
    }).catch(() => wx.showToast({ title: '原图加载失败', icon: 'none' }));
  },
  loadCrop(e) {
    const questionId = e.currentTarget.dataset.id;
    const question = this.data.currentGroup.questions.find(item => item.id === questionId);
    if (!question || question.cropImagePath || question.cropLoading) return Promise.resolve();

    this.updateQuestion(questionId, { cropLoading: true });
    return api.downloadQuestionImage(questionId, 'crop').then(cropImagePath => {
      this.updateQuestion(questionId, { cropImagePath });
    }).catch(() => {
      wx.showToast({ title: '题目图片加载失败', icon: 'none' });
    }).finally(() => this.updateQuestion(questionId, { cropLoading: false }));
  },
  previewCrop(e) {
    const cropImagePath = e.currentTarget.dataset.path;
    if (!cropImagePath) return;
    wx.previewImage({ current: cropImagePath, urls: [cropImagePath] });
  },
  updateQuestion(questionId, changes) {
    const groups = this.data.groups.map((group, groupIndex) => groupIndex === this.data.activeIndex ? ({
      ...group,
      questions: group.questions.map(question => question.id === questionId ? ({ ...question, ...changes }) : question),
    }) : group);
    this.setData({ groups, currentGroup: groups[this.data.activeIndex] });
  },
  setDecision(questionId, decision) {
    const groups = this.data.groups.map((group, groupIndex) => groupIndex === this.data.activeIndex ? ({
      ...group,
      questions: group.questions.map(question => question.id === questionId ? ({ ...question, decision }) : question),
    }) : group);
    this.setData({ groups, currentGroup: groups[this.data.activeIndex] });
  },
  onDecisionTap(e) {
    this.setDecision(e.currentTarget.dataset.id, e.currentTarget.dataset.decision);
  },
  decideAll(e) {
    const group = this.data.currentGroup;
    if (!group) return;
    const decision = e.currentTarget.dataset.decision;
    const groups = this.data.groups.map((item, index) => index === this.data.activeIndex ? ({
      ...item,
      questions: item.questions.map(question => ({ ...question, decision })),
    }) : item);
    this.setData({ groups, currentGroup: groups[this.data.activeIndex] });
  },
  submitGroup() {
    const group = this.data.currentGroup;
    if (!group || this.data.saving) return Promise.resolve();
    if (group.questions.some(question => !question.decision)) {
      wx.showToast({ title: '请先判断本页每一道题', icon: 'none' });
      return Promise.resolve();
    }
    this.setData({ saving: true });
    return api.decideImageReviews(group.image_id, group.questions.map(question => ({
      question_id: question.id,
      decision: question.decision,
    }))).then(result => {
      wx.showToast({ title: `已收录${result.collected}道，未收录${result.ignored}道`, icon: 'none' });
      return this.loadGroups();
    }).catch(() => wx.showToast({ title: '提交失败，请重试', icon: 'none' }))
      .finally(() => this.setData({ saving: false }));
  },
});
