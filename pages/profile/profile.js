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
    this.setData({
      gradeIndex: wx.getStorageSync('grade') || 0,
      semester: wx.getStorageSync('semester') || 0,
      phoneBound: wx.getStorageSync('phoneBound') || false,
      phoneMasked: wx.getStorageSync('phoneMasked') || '',
      nickname: wx.getStorageSync('nickname') || '',
    });
    api.getProfile().then(profile => {
      const gradeIndex = profile.grade - 1;
      const semester = profile.semester - 1;
      wx.setStorageSync('grade', gradeIndex);
      wx.setStorageSync('semester', semester);
      wx.setStorageSync('phoneBound', profile.phone_bound);
      wx.setStorageSync('phoneMasked', profile.phone_masked || '');
      wx.setStorageSync('nickname', profile.nickname || '');
      this.setData({
        gradeIndex,
        semester,
        phoneBound: profile.phone_bound,
        phoneMasked: profile.phone_masked || '',
        nickname: profile.nickname || '',
      });
    }).catch(() => wx.showToast({ title: '资料加载失败', icon: 'none' }));
  },
  onGradeChange(e) {
    const idx = parseInt(e.detail.value);
    wx.setStorageSync('grade', idx);
    this.setData({ gradeIndex: idx });
    api.updateProfile({ grade: idx + 1 })
      .catch(() => wx.showToast({ title: '年级保存失败', icon: 'none' }));
  },
  onSemesterChange(e) {
    const idx = parseInt(e.detail.value);
    wx.setStorageSync('semester', idx);
    this.setData({ semester: idx });
    api.updateProfile({ semester: idx + 1 })
      .catch(() => wx.showToast({ title: '册别保存失败', icon: 'none' }));
  },
  onGetPhone(e) {
    if (e.detail.code) {
      api.bindPhone(e.detail.code).then(() => {
        wx.setStorageSync('phoneBound', true);
        this.setData({ phoneBound: true, phoneMasked: '****' });
      }).catch(() => wx.showToast({ title: '手机号绑定失败', icon: 'none' }));
    }
  },
  onLogout() {
    wx.removeStorageSync('token');
    wx.removeStorageSync('studentId');
    wx.reLaunch({ url: '/pages/profile/profile' });
  },
});
