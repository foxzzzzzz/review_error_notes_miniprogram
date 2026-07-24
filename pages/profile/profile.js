const api = require('../../utils/api');
const session = require('../../utils/session');

const validPickerIndex = (value, length) => (
  Number.isInteger(value) && value >= 0 && value < length
);

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
    const storedGradeIndex = wx.getStorageSync('grade');
    const storedSemester = wx.getStorageSync('semester');
    this.setData({
      gradeIndex: validPickerIndex(storedGradeIndex, this.data.grades.length)
        ? storedGradeIndex
        : 0,
      semester: validPickerIndex(storedSemester, this.data.semesters.length)
        ? storedSemester
        : 0,
      phoneBound: wx.getStorageSync('phoneBound') ?? false,
      phoneMasked: wx.getStorageSync('phoneMasked') ?? '',
      nickname: wx.getStorageSync('nickname') ?? '',
    });
    return api.getProfile().then(profile => {
      const gradeIndex = Number.isInteger(profile.grade)
        ? profile.grade - 1
        : this.data.gradeIndex;
      const semester = Number.isInteger(profile.semester)
        ? profile.semester - 1
        : this.data.semester;
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
    session.logoutLocal({ manual: true, redirect: true });
  },
});
