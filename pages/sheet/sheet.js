const api = require('../../utils/api');
const { SHEET_GENERATION_POLL_INTERVAL_MS } = require('../../utils/config');

const BEIJING_OFFSET_MS = 8 * 60 * 60 * 1000;
const pad = value => String(value).padStart(2, '0');
const uniqueIds = ids => [...new Set(Array.isArray(ids) ? ids : [])];
const activeStatuses = new Set(['pending', 'processing']);

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
        const active = sheets.find(sheet => activeStatuses.has(sheet.generation_status));
        if (active) {
          this.applyGenerationState(active);
          this.startGenerationPolling(active.id);
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
    wx.downloadFile({
      url: this.data.pdfUrl,
      success: res => wx.openDocument({ filePath: res.tempFilePath, fileType: 'pdf' }),
    });
  },

  share() {
    wx.downloadFile({
      url: this.data.pdfUrl,
      success: res => wx.shareFileMessage({ filePath: res.tempFilePath, fileName: '错题集.pdf' }),
    });
  },

  viewSelected() {
    wx.switchTab({ url: '/pages/questions/questions' });
  },

  openSheet(e) {
    const url = api.resolveServerUrl(e.currentTarget.dataset.url);
    wx.downloadFile({
      url,
      success: res => wx.openDocument({ filePath: res.tempFilePath, fileType: 'pdf' }),
    });
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

module.exports = { formatBeijingDateTime };
