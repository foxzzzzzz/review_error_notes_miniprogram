const api = require('../../utils/api');


const createIdempotencyKey = sheetId => (
  `${sheetId}-${Date.now()}-${Math.random().toString(16).slice(2, 14)}`
);

const withStats = groups => {
  const items = groups.flatMap(group => group.items);
  const totalCount = items.length;
  const correctCount = items.filter(item => item.isCorrect).length;
  return {
    groups,
    correctCount,
    totalCount,
    accuracyText: totalCount
      ? `${Math.round((correctCount / totalCount) * 100)}%`
      : '0%',
  };
};


Page({
  data: {
    sheetId: '',
    title: '错题练习结果',
    groups: [],
    correctCount: 0,
    totalCount: 0,
    accuracyText: '0%',
    loading: true,
    submitting: false,
    attemptId: '',
    attemptUpdatedAt: '',
    idempotencyKey: '',
  },

  onLoad(options = {}) {
    const sheetId = options.sheetId || '';
    this.setData({
      sheetId,
      idempotencyKey: createIdempotencyKey(sheetId),
    });
    return this.loadReview();
  },

  loadReview() {
    this.setData({ loading: true });
    return api.getSheetReview(this.data.sheetId)
      .then(review => {
        const groups = (review.groups || []).map(group => ({
          wrongQuestionId: group.wrong_question_id,
          items: (group.items || []).map(item => ({
            sheetItemId: item.sheet_item_id,
            questionType: item.question_type,
            questionText: item.question_text,
            isCorrect: item.is_correct !== false,
          })),
        }));
        const latest = review.latest_attempt;
        this.setData({
          title: review.title || '错题练习结果',
          loading: false,
          attemptId: latest ? latest.id : '',
          attemptUpdatedAt: latest ? latest.updated_at : '',
          ...withStats(groups),
        });
      })
      .catch(error => {
        this.setData({ loading: false });
        wx.showToast({
          title: error && error.message ? error.message : '结果加载失败',
          icon: 'none',
        });
      });
  },

  toggleItem(event) {
    const groupIndex = Number(event.currentTarget.dataset.groupIndex);
    const itemIndex = Number(event.currentTarget.dataset.itemIndex);
    const groups = this.data.groups.map((group, currentGroupIndex) => ({
      ...group,
      items: group.items.map((item, currentItemIndex) => (
        currentGroupIndex === groupIndex && currentItemIndex === itemIndex
          ? { ...item, isCorrect: !item.isCorrect }
          : item
      )),
    }));
    this.setData(withStats(groups));
  },

  selectAll() {
    const groups = this.data.groups.map(group => ({
      ...group,
      items: group.items.map(item => ({ ...item, isCorrect: true })),
    }));
    this.setData(withStats(groups));
  },

  clearAll() {
    const groups = this.data.groups.map(group => ({
      ...group,
      items: group.items.map(item => ({ ...item, isCorrect: false })),
    }));
    this.setData(withStats(groups));
  },

  submit() {
    if (this.data.submitting || !this.data.totalCount) {
      return Promise.resolve();
    }
    this.setData({ submitting: true });
    const items = this.data.groups.flatMap(group => (
      group.items.map(item => ({
        sheet_item_id: item.sheetItemId,
        is_correct: item.isCorrect,
      }))
    ));
    const request = this.data.attemptId
      ? api.updateSheetAttempt(
        this.data.sheetId,
        this.data.attemptId,
        {
          updated_at: this.data.attemptUpdatedAt,
          items,
        }
      )
      : api.createSheetAttempt(this.data.sheetId, {
        idempotency_key: this.data.idempotencyKey,
        completed_at: new Date().toISOString(),
        items,
      });
    return request
      .then(attempt => {
        this.setData({
          submitting: false,
          attemptId: attempt.id,
          attemptUpdatedAt: attempt.updated_at,
        });
        wx.showToast({ title: '结果已保存', icon: 'success' });
      })
      .catch(error => {
        this.setData({ submitting: false });
        if (error && error.statusCode === 409) {
          wx.showToast({
            title: '结果已更新，请重新确认',
            icon: 'none',
          });
          return this.loadReview();
        }
        wx.showToast({
          title: error && error.message ? error.message : '保存失败',
          icon: 'none',
        });
        return undefined;
      });
  },
});


module.exports = { createIdempotencyKey, withStats };
