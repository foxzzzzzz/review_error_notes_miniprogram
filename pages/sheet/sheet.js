const api = require('../../utils/api');

const SERVER_BASE = 'https://your-server.com';

function resolveUrl(path) {
  if (!path) return '';
  if (path.startsWith('http')) return path;
  return SERVER_BASE + path;
}

Page({
  data: {
    selectedIds: [],
    title: '',
    derivedCount: 1,
    difficultyBoost: 2,
    generating: false,
    pdfUrl: '',
    sheets: [],
  },

  onShow() {
    this.setData({ selectedIds: wx.getStorageSync('selectedIds') || [] });
    api.listSheets().then(data => this.setData({ sheets: data }));
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
      this.setData({ pdfUrl: resolveUrl(sheet.pdf_url), generating: false });
      wx.showToast({ title: '生成完成', icon: 'success' });
    }).catch(err => {
      this.setData({ generating: false });
      wx.showToast({ title: '生成失败', icon: 'error' });
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
    const url = resolveUrl(e.currentTarget.dataset.url);
    wx.downloadFile({
      url,
      success: res => wx.openDocument({ filePath: res.tempFilePath, fileType: 'pdf' }),
    });
  },

  onTitleInput(e) { this.setData({ title: e.detail.value }); },

  onDerivedCount(e) { this.setData({ derivedCount: e.detail.value }); },

  onDifficulty(e) { this.setData({ difficultyBoost: e.detail.value }); },
});
