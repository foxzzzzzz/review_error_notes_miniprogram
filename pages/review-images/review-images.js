const api = require('../../utils/api');
const config = require('../../utils/config');
const { hasCompleteReviewFields, buildDecisionPayload, QUESTION_TYPES, questionTypeIndex } = require('../../utils/review-correction');

Page({
  data: {
    pendingGroups: [],
    historyGroups: [],
    historyExpanded: false,
    currentGroup: null,
    currentGroupIsHistory: false,
    activeIndex: 0,
    originalImagePath: '',
    loading: true,
    saving: false,
    questionTypes: QUESTION_TYPES,
  },
  onLoad(options) {
    this.preferredImageId = options.imageId || '';
    return this.loadGroups();
  },
  onShow() {
    if (this.data.refreshAfterManual) {
      this.setData({ refreshAfterManual: false });
      return this.loadGroups();
    }
  },
  loadGroups() {
    this.groupsGeneration = (this.groupsGeneration || 0) + 1;
    this.cropGeneration = (this.cropGeneration || 0) + 1;
    this.setData({ loading: true });
    return api.listReviewImages().then(groups => {
      const prepared = groups.map(group => ({
        ...group,
        thumbnailPath: '',
        questions: (group.questions || []).map(question => ({
          ...question,
          decision: '',
          review_fields: {
            instruction: (question.review_fields || {}).instruction || '',
            prompt_text: (question.review_fields || {}).prompt_text || '',
            question_type: (question.review_fields || {}).question_type || '',
            correct_answer: question.ocr_answer || '',
          },
          questionTypeIndex: questionTypeIndex((question.review_fields || {}).question_type),
          cropImagePath: '',
          cropLoading: false,
        })),
      }));
      const pendingGroups = prepared.filter(group => group.group_type !== 'completed_image');
      const historyGroups = prepared.filter(group => group.group_type === 'completed_image');
      const preferredIndex = pendingGroups.findIndex(group => group.image_id === this.preferredImageId);
      this.setData({ pendingGroups, historyGroups, loading: false, historyExpanded: false });
      if (!pendingGroups.length) {
        this.setData({ currentGroup: null, currentGroupIsHistory: false, originalImagePath: '' });
        return Promise.resolve();
      }
      return this.selectGroup(preferredIndex >= 0 ? preferredIndex : 0);
    }).catch(() => {
      this.setData({ loading: false });
      wx.showToast({ title: '待确认题目加载失败', icon: 'none' });
    });
  },
  selectGroup(index) {
    const generation = this.cropGeneration = (this.cropGeneration || 0) + 1;
    const group = this.data.pendingGroups[index];
    if (!group) {
      this.setData({ currentGroup: null, currentGroupIsHistory: false, originalImagePath: '' });
      return Promise.resolve();
    }
    this.setData({ activeIndex: index, currentGroup: group, currentGroupIsHistory: false, originalImagePath: group.thumbnailPath });
    const original = group.thumbnailPath ? Promise.resolve(group.thumbnailPath) : this.loadGroupOriginal(index);
    this.loadActiveGroupCrops(index, generation);
    return original.catch(() => '')
      .then(originalImagePath => {
        if (generation === this.cropGeneration) this.setData({ originalImagePath });
      });
  },
  loadGroupOriginal(index) {
    const group = this.data.pendingGroups[index];
    if (!group) return Promise.resolve('');
    if (group.thumbnailPath) return Promise.resolve(group.thumbnailPath);
    const groupsGeneration = this.groupsGeneration;
    const download = group.group_type === 'image_issue' || !group.questions.length
      ? api.downloadNormalizedOriginalImage(group.image_id)
      : api.downloadQuestionImage(group.questions[0].id, 'original');
    return download.then(thumbnailPath => {
      const activeAtIndex = this.data.pendingGroups[index];
      if (groupsGeneration !== this.groupsGeneration || !activeAtIndex || activeAtIndex.image_id !== group.image_id) {
        return thumbnailPath;
      }
      const pendingGroups = this.data.pendingGroups.map((item, groupIndex) => groupIndex === index ? ({
        ...item,
        thumbnailPath,
      }) : item);
      const activeGroup = pendingGroups[this.data.activeIndex];
      this.setData({ pendingGroups, ...(!this.data.currentGroupIsHistory && activeGroup
        && activeGroup.image_id === group.image_id
        ? { currentGroup: pendingGroups[this.data.activeIndex] } : {}) });
      return thumbnailPath;
    });
  },
  onGroupTap(e) {
    return this.selectGroup(Number(e.currentTarget.dataset.index));
  },
  toggleHistory() {
    this.setData({ historyExpanded: !this.data.historyExpanded });
  },
  selectHistoryGroup(index) {
    const generation = this.cropGeneration = (this.cropGeneration || 0) + 1;
    const group = this.data.historyGroups[index];
    if (!group) return Promise.resolve();
    this.setData({ currentGroup: group, currentGroupIsHistory: true, originalImagePath: group.thumbnailPath || '' });
    if (group.thumbnailPath) return Promise.resolve();
    return this.loadHistoricalOriginal(index).then(originalImagePath => {
      if (generation === this.cropGeneration) this.setData({ originalImagePath });
    }).catch(() => {
      if (generation === this.cropGeneration) this.setData({ originalImagePath: '' });
    });
  },
  onHistoryGroupTap(e) {
    return this.selectHistoryGroup(Number(e.currentTarget.dataset.index));
  },
  loadHistoricalOriginal(index) {
    const group = this.data.historyGroups[index];
    if (!group) return Promise.resolve('');
    if (group.thumbnailPath) return Promise.resolve(group.thumbnailPath);
    return api.downloadNormalizedOriginalImage(group.image_id).then(thumbnailPath => {
      const historyGroups = this.data.historyGroups.map((item, groupIndex) => groupIndex === index
        ? { ...item, thumbnailPath } : item);
      this.setData({ historyGroups });
      return thumbnailPath;
    });
  },
  previewOriginal() {
    const group = this.data.currentGroup;
    if (!group) return Promise.resolve();
    if (this.data.originalImagePath) {
      wx.previewImage({ current: this.data.originalImagePath, urls: [this.data.originalImagePath] });
      return Promise.resolve();
    }
    const download = group.group_type === 'image_issue' || !group.questions.length
      ? api.downloadNormalizedOriginalImage(group.image_id)
      : api.downloadQuestionImage(group.questions[0].id, 'original');
    return download.then(path => {
      if (this.data.currentGroup && this.data.currentGroup.image_id === group.image_id) {
        this.setData({ originalImagePath: path });
        wx.previewImage({ current: path, urls: [path] });
      }
    }).catch(() => wx.showToast({ title: '原图加载失败', icon: 'none' }));
  },
  loadCrop(e) {
    const questionId = e.currentTarget.dataset.id;
    const groupIndex = this.data.activeIndex;
    const group = this.data.pendingGroups[groupIndex];
    const question = group && group.questions.find(item => item.id === questionId);
    if (!question || question.cropImagePath || question.cropLoading) return Promise.resolve();
    const generation = this.cropGeneration;
    const groupsGeneration = this.groupsGeneration;
    this.updateQuestion(questionId, { cropLoading: true });
    return this.downloadCrop(questionId, generation, groupsGeneration).catch(() => {
      if (groupsGeneration === this.groupsGeneration) {
        this.updateQuestionInGroup(groupIndex, questionId, { cropLoading: false });
      }
      if (generation === this.cropGeneration) wx.showToast({ title: '题目图片加载失败，请点按重试', icon: 'none' });
    });
  },
  loadActiveGroupCrops(index, generation) {
    const group = this.data.pendingGroups[index];
    if (!group) return Promise.resolve();
    const groupsGeneration = this.groupsGeneration;
    return Promise.all(group.questions.map(question => this.downloadCrop(question.id, generation, groupsGeneration)
      .catch(() => {
        if (groupsGeneration === this.groupsGeneration) {
          this.updateQuestionInGroup(index, question.id, { cropLoading: false });
        }
      })));
  },
  downloadCrop(questionId, generation, groupsGeneration) {
    const requestGeneration = groupsGeneration === undefined ? this.groupsGeneration : groupsGeneration;
    const groupIndex = this.data.pendingGroups.findIndex(group => group.questions.some(question => question.id === questionId));
    const group = this.data.pendingGroups[groupIndex];
    const question = group && group.questions.find(item => item.id === questionId);
    if (!question || question.cropImagePath) return Promise.resolve();
    if (!this.cropQueue) this.cropQueue = [];
    if (!this.cropDownloadsInFlight) this.cropDownloadsInFlight = 0;
    if (!this.cropPromises) this.cropPromises = {};
    if (!this.cropInFlight) this.cropInFlight = {};
    const inFlightKey = `${requestGeneration}:${questionId}`;
    if (this.cropInFlight[inFlightKey]) return this.cropInFlight[inFlightKey];
    const promiseKey = `${requestGeneration}:${generation}:${questionId}`;
    if (this.cropPromises[promiseKey]) return this.cropPromises[promiseKey];
    this.updateQuestionInGroup(groupIndex, questionId, { cropLoading: true });
    const request = { questionId, groupIndex, imageId: group.image_id, generation,
      groupsGeneration: requestGeneration };
    const promise = new Promise((resolve, reject) => {
      request.resolve = resolve;
      request.reject = reject;
    });
    const trackedPromise = promise.finally(() => {
      if (this.cropPromises[promiseKey] === trackedPromise) delete this.cropPromises[promiseKey];
    });
    request.promise = trackedPromise;
    this.cropPromises[promiseKey] = trackedPromise;
    this.cropQueue.push(request);
    this.pumpCropQueue();
    return trackedPromise;
  },
  pumpCropQueue() {
    const maxDownloads = Math.max(1, Number(config.REVIEW_CROP_CONCURRENCY) || 1);
    while (this.cropDownloadsInFlight < maxDownloads && this.cropQueue && this.cropQueue.length) {
      const request = this.cropQueue.shift();
      const group = this.data.pendingGroups[request.groupIndex];
      const question = group && group.questions.find(item => item.id === request.questionId);
      if (!question || request.generation !== this.cropGeneration
        || request.groupsGeneration !== this.groupsGeneration || group.image_id !== request.imageId) {
        request.resolve();
        continue;
      }
      this.cropDownloadsInFlight += 1;
      const inFlightKey = `${request.groupsGeneration}:${request.questionId}`;
      this.cropInFlight[inFlightKey] = request.promise;
      api.downloadQuestionImage(request.questionId, 'crop').then(cropImagePath => {
        if (request.groupsGeneration === this.groupsGeneration) {
          const currentGroup = this.data.pendingGroups[request.groupIndex];
          if (currentGroup && currentGroup.image_id === request.imageId) {
            this.updateQuestionInGroup(request.groupIndex, request.questionId, { cropImagePath, cropLoading: false });
          }
        }
        request.resolve(cropImagePath);
      }).catch(error => {
        if (request.groupsGeneration === this.groupsGeneration) {
          const currentGroup = this.data.pendingGroups[request.groupIndex];
          if (currentGroup && currentGroup.image_id === request.imageId) {
            this.updateQuestionInGroup(request.groupIndex, request.questionId, { cropLoading: false });
          }
        }
        request.reject(error);
      }).finally(() => {
        if (this.cropInFlight[inFlightKey] === request.promise) delete this.cropInFlight[inFlightKey];
        this.cropDownloadsInFlight -= 1;
        this.pumpCropQueue();
      });
    }
  },
  previewCrop(e) {
    const cropImagePath = e.currentTarget.dataset.path;
    if (!cropImagePath) return;
    wx.previewImage({ current: cropImagePath, urls: [cropImagePath] });
  },
  updateQuestion(questionId, changes) {
    this.updateQuestionInGroup(this.data.activeIndex, questionId, changes);
  },
  updateQuestionInGroup(groupIndex, questionId, changes) {
    const pendingGroups = this.data.pendingGroups.map((group, index) => index === groupIndex ? ({
      ...group,
      questions: group.questions.map(question => question.id === questionId ? ({ ...question, ...changes }) : question),
    }) : group);
    this.setData({ pendingGroups, ...(groupIndex === this.data.activeIndex && !this.data.currentGroupIsHistory
      ? { currentGroup: pendingGroups[groupIndex] } : {}) });
  },
  setDecision(questionId, decision) {
    const pendingGroups = this.data.pendingGroups.map((group, groupIndex) => groupIndex === this.data.activeIndex ? ({
      ...group,
      questions: group.questions.map(question => question.id === questionId ? ({ ...question, decision }) : question),
    }) : group);
    this.setData({ pendingGroups, currentGroup: pendingGroups[this.data.activeIndex] });
  },
  onDecisionTap(e) {
    this.setDecision(e.currentTarget.dataset.id, e.currentTarget.dataset.decision);
  },
  onReviewFieldInput(e) {
    const { id, field } = e.currentTarget.dataset;
    const question = this.data.currentGroup.questions.find(item => item.id === id);
    if (!question || !['instruction', 'prompt_text', 'question_type', 'correct_answer'].includes(field)) return;
    this.updateQuestion(id, {
      review_fields: { ...question.review_fields, [field]: e.detail.value },
    });
  },
  onReviewTypeChange(e) {
    const id = e.currentTarget.dataset.id;
    const selected = this.data.questionTypes[Number(e.detail.value)];
    const question = this.data.currentGroup.questions.find(item => item.id === id);
    if (!selected || !question) return;
    this.updateQuestion(id, {
      questionTypeIndex: Number(e.detail.value),
      review_fields: { ...question.review_fields, question_type: selected.value },
    });
  },
  onAddMissedTap() {
    const group = this.data.currentGroup;
    if (!group || this.data.saving) return;
    this.preferredImageId = group.image_id;
    wx.navigateTo({
      url: `/pages/manual-question/manual-question?imageId=${encodeURIComponent(group.image_id)}`,
    });
  },
  decideAll(e) {
    const group = this.data.currentGroup;
    if (!group) return;
    const decision = e.currentTarget.dataset.decision;
    const pendingGroups = this.data.pendingGroups.map((item, index) => index === this.data.activeIndex ? ({
      ...item,
      questions: item.questions.map(question => ({ ...question, decision })),
    }) : item);
    this.setData({ pendingGroups, currentGroup: pendingGroups[this.data.activeIndex] });
  },
  onReprocessTap() {
    const group = this.data.currentGroup;
    if (!group || this.data.saving) return;
    const corrections = ['missed_errors', 'false_positives', 'both'];
    wx.showActionSheet({
      itemList: ['漏识别错题', '误识别正确题', '两者都有'],
      success: ({ tapIndex }) => wx.showModal({
        title: '重新识别此图',
        content: '当前未确认候选将被替换，原图无需重新上传。',
        confirmText: '重新识别',
        success: ({ confirm }) => {
          if (!confirm) return;
          this.setData({ saving: true });
          api.reprocessReviewImage(group.image_id, corrections[tapIndex])
            .then(() => {
              wx.showToast({ title: '已重新识别，可返回拍照页查看进度', icon: 'none' });
              return this.loadGroups();
            })
            .catch(() => wx.showToast({ title: '重新识别失败，请稍后重试', icon: 'none' }))
            .finally(() => this.setData({ saving: false }));
        },
      }),
    });
  },
  reprocessImage(correction) {
    const group = this.data.currentGroup;
    if (!group || this.data.saving) return Promise.resolve();
    this.setData({ saving: true });
    return api.reprocessReviewImage(group.image_id, correction)
      .then(() => {
        wx.showToast({ title: '已重新提交识别', icon: 'none' });
        return this.loadGroups();
      })
      .catch(() => wx.showToast({ title: '重新识别失败，请稍后重试', icon: 'none' }))
      .finally(() => this.setData({ saving: false }));
  },
  onRetryMarks() {
    return this.reprocessImage('missed_errors');
  },
  onForceUnmarked() {
    return this.reprocessImage('force_unmarked');
  },
  onCancelImage() {
    const group = this.data.currentGroup;
    if (!group || this.data.saving) return Promise.resolve();
    this.setData({ saving: true });
    return api.cancelImages([group.image_id])
      .then(() => this.loadGroups())
      .catch(() => wx.showToast({ title: '操作失败，请稍后重试', icon: 'none' }))
      .finally(() => this.setData({ saving: false }));
  },
  onRetake() {
    const group = this.data.currentGroup;
    if (!group || this.data.saving) return;
    wx.showModal({
      title: '重新拍摄',
      content: '将不再处理当前图片，并返回拍照录入页。',
      confirmText: '重新拍摄',
      success: ({ confirm }) => {
        if (!confirm) return;
        this.setData({ saving: true });
        api.cancelImages([group.image_id])
          .then(() => wx.switchTab({ url: '/pages/capture/capture' }))
          .catch(() => wx.showToast({ title: '操作失败，请稍后重试', icon: 'none' }))
          .finally(() => this.setData({ saving: false }));
      },
    });
  },
  submitGroup() {
    const group = this.data.currentGroup;
    if (!group || this.data.saving) return Promise.resolve();
    if (group.questions.some(question => !question.decision)) {
      wx.showToast({ title: '请先判断本页每一道题', icon: 'none' });
      return Promise.resolve();
    }
    const invalid = group.questions.find(question => question.decision === 'collect'
      && !hasCompleteReviewFields(question));
    if (invalid) {
      wx.showToast({ title: '请补全题目要求、内容、题型和正确答案', icon: 'none' });
      return Promise.resolve();
    }
    this.setData({ saving: true });
    return api.decideImageReviews(group.image_id, buildDecisionPayload(group.questions)).then(result => {
      wx.showToast({ title: `已收录${result.collected}道，未收录${result.ignored}道`, icon: 'none' });
      return this.loadGroups();
    }).catch(() => wx.showToast({ title: '提交失败，请重试', icon: 'none' }))
      .finally(() => this.setData({ saving: false }));
  },
});
