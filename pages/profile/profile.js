const api = require('../../utils/api');

Page({
  data: {
    nickname: '',
    phoneBound: true,
    phoneMasked: '',
    grades: ['一年级','二年级','三年级','四年级','五年级','六年级'],
    gradeIndex: 0,
    semesters: ['上册','下册'],
    semester: 0,
    stats: { total: 0, monthNew: 0, mastered: 0 },
  },
  onShow() {
    this.loadProfile();
  },
  loadProfile() {
    // 从本地缓存读取设置
    this.setData({
      gradeIndex: wx.getStorageSync('grade') || 0,
      semester: wx.getStorageSync('semester') || 0,
      phoneBound: wx.getStorageSync('phoneBound') || false,
      phoneMasked: wx.getStorageSync('phoneMasked') || '',
      nickname: wx.getStorageSync('nickname') || '',
    });
  },
  onGradeChange(e) {
    const idx = parseInt(e.detail.value);
    wx.setStorageSync('grade', idx);
    this.setData({ gradeIndex: idx });
  },
  onSemesterChange(e) {
    const idx = parseInt(e.detail.value);
    wx.setStorageSync('semester', idx);
    this.setData({ semester: idx });
  },
  onGetPhone(e) {
    if (e.detail.encryptedData) {
      api.bindPhone(e.detail.encryptedData, e.detail.iv).then(() => {
        wx.setStorageSync('phoneBound', true);
        this.setData({ phoneBound: true, phoneMasked: '****' });
      });
    }
  },
  onLogout() {
    wx.removeStorageSync('token');
    wx.removeStorageSync('studentId');
    wx.reLaunch({ url: '/pages/profile/profile' });
  },
});
