const api = require('../../utils/api');

const BEIJING_OFFSET_MS = 8 * 60 * 60 * 1000;
const pad = value => String(value).padStart(2, '0');

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

Page({
  data: {
    selectedIds: [],
    title: '',
    derivedCount: 0,
    difficultyBoost: 2,
    generating: false,
    pdfUrl: '',
    sheets: [],
  },

  onShow() {
    this.setData({ selectedIds: wx.getStorageSync('selectedIds') || [] });
    return api.listSheets()
      .then(data => this.setData({
        sheets: data.map(sheet => ({
          ...sheet,
          createdAtText: formatBeijingDateTime(sheet.created_at),
        })),
      }))
      .catch(() => wx.showToast({ title: '历史记录加载失败', icon: 'none' }));
  },

  generate() {
    if (this.data.selectedIds.length === 0) return;
    this.setData({ generating: true });
    api.createSheet({
      title: this.data.title || '错题重练',
      question_ids: this.data.selectedIds,
      derived_per_original: parseInt(this.data.derivedCount),
      difficulty_boost: parseInt(this.data.difficultyBoost),
    }).then(sheet => {
      this.setData({ pdfUrl: api.resolveServerUrl(sheet.pdf_url), generating: false });
      wx.showToast({ title: '生成完成', icon: 'success' });
    }).catch(err => {
      this.setData({ generating: false });
      wx.showToast({
        title: err && err.message ? err.message : '生成失败',
        icon: 'none',
        duration: 3000,
      });
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

  onTitleInput(e) { this.setData({ title: e.detail.value }); },

  onDerivedCount(e) { this.setData({ derivedCount: parseInt(e.detail.value) }); },

  onDifficulty(e) { this.setData({ difficultyBoost: e.detail.value }); },
});

module.exports = { formatBeijingDateTime };
