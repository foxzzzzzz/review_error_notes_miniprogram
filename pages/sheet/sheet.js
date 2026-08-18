const api = require('../../utils/api');
const { SHEET_GENERATION_POLL_INTERVAL_MS } = require('../../utils/config');

const BEIJING_OFFSET_MS = 8 * 60 * 60 * 1000;
const pad = value => String(value).padStart(2, '0');
const uniqueIds = ids => [...new Set(Array.isArray(ids) ? ids : [])];
const activeStatuses = new Set(['pending', 'processing']);
const terminalStatuses = new Set(['completed', 'failed']);
const SWIPE_TRIGGER_PX = 45;

const showModal = options => new Promise((resolve, reject) => {
  const result = wx.showModal({
    ...options,
    success: resolve,
    fail: reject,
  });
  if (result && typeof result.then === 'function') {
    result.then(resolve, reject);
  }
});

const formatBeijingDateTime = createdAt => {
  if (!createdAt) return '';
  const text = String(createdAt);
  const date = new Date(/(?:Z|[+-]\d{2}:?\d{2})$/i.test(text) ? text : `${text}Z`);
  if (Number.isNaN(date.getTime())) return '';

  const beijingDate = new Date(date.getTime() + BEIJING_OFFSET_MS);
  return [
    beijingDate.getUTCFullYear(),
    pad(beijingDate.getUTCMonth() + 1),
    pad(beijingDate.getUTCDate()),
  ].join('-') + ` ${pad(beijingDate.getUTCHours())}:${pad(beijingDate.getUTCMinutes())}`;
};

const formatGenerationDuration = (value, generationStatus) => {
  if (generationStatus !== 'completed' || value === null || value === '') return '';
  const seconds = Number(value);
  if (!Number.isInteger(seconds) || seconds < 0) return '';
  return `生成时长：${seconds} s`;
};

const formatSheet = sheet => {
  const generationStatus = sheet.generation_status || 'completed';
  const generationTotal = Number(sheet.generation_total || 0);
  const generationCompleted = Number(sheet.generation_completed || 0);
  const progressText = `${generationCompleted}/${generationTotal}`;
  const generationStatusText = {
    pending: '等待生成',
    processing: `生成中 ${progressText}`,
    completed: '生成完成',
    failed: '生成失败',
  }[generationStatus] || generationStatus;
  return {
    ...sheet,
    generation_status: generationStatus,
    generation_total: generationTotal,
    generation_completed: generationCompleted,
    progressText,
    generationStatusText,
    canOpen: generationStatus === 'completed',
    canDelete: terminalStatuses.has(generationStatus),
    generationDurationText: formatGenerationDuration(
      sheet.generation_duration_seconds,
      generationStatus
    ),
    createdAtText: formatBeijingDateTime(sheet.created_at),
    accuracyText: sheet.latest_accuracy == null
      ? ''
      : `${Math.round(Number(sheet.latest_accuracy) * 100)}%`,
  };
};

Page({
  data: {
    selectedIds: [],
    title: '',
    derivedCount: 0,
    difficultyBoost: 2,
    generating: false,
    activeGeneration: null,
    generationError: '',
    pdfUrl: '',
    sheets: [],
    swipedSheetId: '',
    deletingSheetId: '',
  },

  onShow() {
    this._pageVisible = true;
    this.stopGenerationPolling();
    this.setData({ selectedIds: uniqueIds(wx.getStorageSync('selectedIds')) });
    return this.loadSheets();
  },

  onHide() {
    this._pageVisible = false;
    this.stopGenerationPolling();
  },

  onUnload() {
    this._pageVisible = false;
    this.stopGenerationPolling();
  },

  loadSheets() {
    return api.listSheets()
      .then(data => {
        const sheets = data.map(formatSheet);
        this.setData({ sheets });
        const activeId = this.data.activeGeneration && this.data.activeGeneration.id;
        const current = activeId
          ? sheets.find(sheet => sheet.id === activeId)
          : null;
        const active = current
          || sheets.find(sheet => activeStatuses.has(sheet.generation_status));
        if (active) {
          this.applyGenerationState(active);
          if (activeStatuses.has(active.generation_status)) {
            this.startGenerationPolling(active.id);
          }
        }
        return sheets;
      })
      .catch(() => wx.showToast({ title: '历史记录加载失败', icon: 'none' }));
  },

  generate() {
    if (this.data.generating || this.data.selectedIds.length === 0) {
      return Promise.resolve();
    }
    this._pageVisible = true;
    const questionIds = uniqueIds(this.data.selectedIds);
    this.setData({
      generating: true,
      generationError: '',
      pdfUrl: '',
      activeGeneration: formatSheet({
        generation_status: 'pending',
        generation_total: questionIds.length,
        generation_completed: 0,
      }),
    });
    return api.createSheet({
      title: this.data.title || '错题重练',
      question_ids: questionIds,
      derived_per_original: parseInt(this.data.derivedCount),
      difficulty_boost: parseInt(this.data.difficultyBoost),
    }).then(sheet => {
      this.applyGenerationState(sheet);
      if (activeStatuses.has(sheet.generation_status)) {
        this.startGenerationPolling(sheet.id);
        wx.showToast({ title: '已加入生成队列', icon: 'none' });
      }
      return sheet;
    }).catch(err => {
      const message = err && err.message ? err.message : '生成失败，请稍后重试';
      this.setData({
        generating: false,
        generationError: message,
        activeGeneration: formatSheet({
          generation_status: 'failed',
          generation_total: questionIds.length,
          generation_completed: 0,
          generation_error_message: message,
        }),
      });
      wx.showToast({
        title: message,
        icon: 'none',
        duration: 3000,
      });
      return this.loadSheets();
    });
  },

  applyGenerationState(sheet) {
    const activeGeneration = formatSheet(sheet);
    const completed = activeGeneration.generation_status === 'completed';
    const failed = activeGeneration.generation_status === 'failed';
    const currentSheets = Array.isArray(this.data.sheets) ? this.data.sheets : [];
    const matched = activeGeneration.id
      ? currentSheets.some(item => item.id === activeGeneration.id)
      : false;
    const sheets = !activeGeneration.id
      ? currentSheets
      : matched
        ? currentSheets.map(item => item.id === activeGeneration.id
          ? formatSheet({ ...item, ...sheet })
          : item)
        : [activeGeneration, ...currentSheets];
    this.setData({
      activeGeneration,
      sheets,
      generating: activeStatuses.has(activeGeneration.generation_status),
      generationError: failed
        ? (activeGeneration.generation_error_message || '错题集生成失败，请稍后重试')
        : '',
      pdfUrl: completed
        ? api.resolveServerUrl(activeGeneration.pdf_url)
        : '',
    });
    if (completed || failed) this.stopGenerationPolling();
  },

  startGenerationPolling(sheetId) {
    if (!sheetId || this._pageVisible === false) return;
    this.stopGenerationPolling();
    const generation = this._pollingGeneration;
    const poll = () => {
      this.generationPollingTimer = null;
      api.getSheetGeneration(sheetId).then(sheet => {
        if (generation !== this._pollingGeneration || this._pageVisible === false) return;
        this.applyGenerationState(sheet);
        if (activeStatuses.has(sheet.generation_status)) {
          this.generationPollingTimer = setTimeout(poll, SHEET_GENERATION_POLL_INTERVAL_MS);
        }
      }).catch(() => {
        if (generation === this._pollingGeneration && this._pageVisible !== false) {
          this.generationPollingTimer = setTimeout(poll, SHEET_GENERATION_POLL_INTERVAL_MS);
        }
      });
    };
    this.generationPollingTimer = setTimeout(poll, SHEET_GENERATION_POLL_INTERVAL_MS);
  },

  stopGenerationPolling() {
    this._pollingGeneration = (this._pollingGeneration || 0) + 1;
    if (this.generationPollingTimer != null) {
      clearTimeout(this.generationPollingTimer);
      this.generationPollingTimer = null;
    }
  },

  onHistoryTouchStart(e) {
    const dataset = e.currentTarget.dataset || {};
    const touch = e.touches && e.touches[0];
    if (!touch || !terminalStatuses.has(dataset.status)) {
      this._historyTouch = null;
      return;
    }
    this._historyTouch = {
      id: dataset.id,
      x: touch.clientX,
      y: touch.clientY,
    };
  },

  onHistoryTouchMove() {},

  onHistoryTouchEnd(e) {
    const start = this._historyTouch;
    this._historyTouch = null;
    const touch = e.changedTouches && e.changedTouches[0];
    if (!start || !touch) return;

    const deltaX = touch.clientX - start.x;
    const deltaY = touch.clientY - start.y;
    if (Math.abs(deltaX) <= Math.abs(deltaY) || Math.abs(deltaX) < SWIPE_TRIGGER_PX) {
      return;
    }
    this.setData({ swipedSheetId: deltaX < 0 ? start.id : '' });
  },

  closeHistorySwipe() {
    if (this.data.swipedSheetId) this.setData({ swipedSheetId: '' });
  },

  confirmDeleteSheet(e) {
    const sheetId = e.currentTarget.dataset.id;
    if (!sheetId || this.data.deletingSheetId) return Promise.resolve();
    this.setData({ deletingSheetId: sheetId });
    return showModal({
      title: '删除错题集？',
      content: '删除后将同时清除该错题集、PDF 和已记录的练习结果，并重新计算错题状态。此操作不可恢复。',
      confirmText: '删除',
      confirmColor: '#e64340',
      cancelText: '取消',
    }).then(result => {
      if (!result.confirm) {
        this.setData({ deletingSheetId: '' });
        return null;
      }
      return api.deleteSheet(sheetId).then(() => {
        const deletingActive = this.data.activeGeneration
          && this.data.activeGeneration.id === sheetId;
        const nextData = {
          sheets: this.data.sheets.filter(item => item.id !== sheetId),
          swipedSheetId: '',
          deletingSheetId: '',
        };
        if (deletingActive) {
          this.stopGenerationPolling();
          Object.assign(nextData, {
            activeGeneration: null,
            generationError: '',
            generating: false,
            pdfUrl: '',
          });
        }
        this.setData(nextData);
        wx.showToast({ title: '已删除', icon: 'success' });
        return null;
      });
    }).catch(error => {
      this.setData({ swipedSheetId: '', deletingSheetId: '' });
      wx.showToast({
        title: (error && error.message) || '删除失败，请稍后重试',
        icon: 'none',
      });
      return null;
    });
  },

  retryGeneration(e) {
    const sheetId = (e && e.currentTarget && e.currentTarget.dataset.id)
      || (this.data.activeGeneration && this.data.activeGeneration.id);
    if (!sheetId || this.data.generating) return Promise.resolve();
    this.setData({ generating: true, generationError: '' });
    return api.retrySheetGeneration(sheetId).then(sheet => {
      this.applyGenerationState(sheet);
      if (activeStatuses.has(sheet.generation_status)) {
        this.startGenerationPolling(sheet.id);
      }
      return sheet;
    }).catch(err => {
      const message = err && err.message ? err.message : '重新生成失败，请稍后重试';
      this.setData({ generating: false, generationError: message });
      wx.showToast({ title: message, icon: 'none' });
    });
  },

  adjustGeneration() {
    this.stopGenerationPolling();
    this.setData({
      activeGeneration: null,
      generationError: '',
      generating: false,
      pdfUrl: '',
    });
  },

  preview() {
    return api.downloadSheet(this.data.activeGeneration.id)
      .then(filePath => wx.openDocument({ filePath, fileType: 'pdf' }));
  },

  sharePdf(sheetId) {
    return api.downloadSheet(sheetId)
      .then(filePath => wx.shareFileMessage({ filePath, fileName: '错题集.pdf' }));
  },

  share() {
    return this.sharePdf(this.data.activeGeneration.id);
  },

  shareSheet(e) {
    return this.sharePdf(e.currentTarget.dataset.id);
  },

  viewSelected() {
    wx.switchTab({ url: '/pages/questions/questions' });
  },

  openSheet(e) {
    return api.downloadSheet(e.currentTarget.dataset.id)
      .then(filePath => wx.openDocument({ filePath, fileType: 'pdf' }));
  },

  openResult(e) {
    wx.navigateTo({
      url: `/pages/sheet-result/result?sheetId=${encodeURIComponent(e.currentTarget.dataset.id)}`,
    });
  },

  onTitleInput(e) { this.setData({ title: e.detail.value }); },

  onDerivedCount(e) { this.setData({ derivedCount: parseInt(e.detail.value) }); },

  onDifficulty(e) { this.setData({ difficultyBoost: e.detail.value }); },
});

module.exports = { formatBeijingDateTime, formatGenerationDuration };
