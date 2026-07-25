const api = require('../../utils/api');
const session = require('../../utils/session');

const GRADES = ['一年级', '二年级', '三年级', '四年级', '五年级', '六年级'];
const SEMESTERS = ['上册', '下册'];
const pad = value => String(value).padStart(2, '0');

const getBeijingMonthStart = (now = new Date()) => {
  const beijing = new Date(now.getTime() + 8 * 60 * 60 * 1000);
  return `${beijing.getUTCFullYear()}-${pad(beijing.getUTCMonth() + 1)}-01T00:00:00+08:00`;
};

const validPickerIndex = (value, length) => (
  Number.isInteger(value) && value >= 0 && value < length
);

Page({
  data: {
    loggedIn: false,
    loading: false,
    nickname: '',
    nicknameDraft: '',
    avatarUrl: '',
    avatarTempPath: '',
    avatarInitial: '学',
    studentName: '',
    phoneBound: false,
    phoneMasked: '',
    grades: GRADES,
    gradeIndex: 0,
    gradeSet: false,
    semesters: SEMESTERS,
    semester: 0,
    semesterSet: false,
    studentProfileRequired: true,
    showProfilePrompt: false,
    stats: {
      total: 0,
      monthNew: 0,
      needsReview: 0,
      mastered: 0,
    },
  },

  onShow() {
    const loggedIn = Boolean(wx.getStorageSync('token'))
      && !wx.getStorageSync('manualLogout');
    this.setData({ loggedIn });
    if (!loggedIn) return Promise.resolve();
    return this.loadProfile();
  },

  applyProfile(profile) {
    const storedGradeIndex = wx.getStorageSync('grade');
    const storedSemester = wx.getStorageSync('semester');
    const gradeSet = Number.isInteger(profile.grade);
    const semesterSet = Number.isInteger(profile.semester);
    const gradeIndex = gradeSet
      ? profile.grade - 1
      : (validPickerIndex(storedGradeIndex, GRADES.length) ? storedGradeIndex : 0);
    const semester = semesterSet
      ? profile.semester - 1
      : (validPickerIndex(storedSemester, SEMESTERS.length) ? storedSemester : 0);
    const nickname = profile.nickname || '';
    const avatarUrl = profile.avatar_url ? this.data.avatarUrl : '';
    const stats = profile.stats || {};

    if (gradeSet) wx.setStorageSync('grade', gradeIndex);
    if (semesterSet) wx.setStorageSync('semester', semester);
    wx.setStorageSync('profilePromptRequired', profile.profile_prompt_required === true);
    wx.setStorageSync('studentProfileRequired', profile.student_profile_required === true);
    wx.setStorageSync('phoneBound', profile.phone_bound === true);
    wx.setStorageSync('phoneMasked', profile.phone_masked || '');
    wx.setStorageSync('nickname', nickname);

    this.setData({
      loggedIn: true,
      nickname,
      nicknameDraft: nickname,
      avatarUrl,
      avatarTempPath: '',
      avatarInitial: nickname ? nickname[0] : '学',
      studentName: profile.student_name || '默认学生',
      gradeIndex,
      gradeSet,
      semester,
      semesterSet,
      studentProfileRequired: profile.student_profile_required === true,
      phoneBound: profile.phone_bound === true,
      phoneMasked: profile.phone_masked || '',
      showProfilePrompt: profile.profile_prompt_required === true,
      stats: {
        total: stats.total || 0,
        monthNew: stats.month_new || 0,
        needsReview: stats.needs_review || 0,
        mastered: stats.mastered || 0,
      },
    });
  },

  loadProfile() {
    this.setData({ loading: true });
    return api.getProfile()
      .then(profile => {
        this.applyProfile(profile);
        if (!profile.avatar_url) return null;
        return api.downloadAvatar(profile.avatar_url)
          .then(avatarUrl => this.setData({ avatarUrl }))
          .catch(() => this.setData({
            avatarUrl: '',
            avatarTempPath: '',
          }));
      })
      .catch(() => wx.showToast({ title: '资料加载失败', icon: 'none' }))
      .finally(() => this.setData({ loading: false }));
  },

  onLogin() {
    this.setData({ loading: true });
    return session.login({ force: true })
      .then(() => {
        this.setData({ loggedIn: true });
        return this.loadProfile();
      })
      .catch(() => wx.showToast({ title: '登录失败，请重试', icon: 'none' }))
      .finally(() => this.setData({ loading: false }));
  },

  onNicknameInput(e) {
    this.setData({ nicknameDraft: e.detail.value });
  },

  onChooseAvatar(e) {
    const avatarTempPath = e.detail.avatarUrl;
    if (!avatarTempPath) return Promise.resolve();
    this.setData({ avatarTempPath });
    if (this.data.showProfilePrompt) return Promise.resolve();
    return this.uploadSelectedAvatar();
  },

  uploadSelectedAvatar() {
    if (!this.data.avatarTempPath) return Promise.resolve(null);
    const avatarTempPath = this.data.avatarTempPath;
    return api.uploadAvatar(avatarTempPath).then(profile => {
      this.applyProfile(profile);
      this.setData({
        avatarUrl: avatarTempPath,
        avatarTempPath: '',
      });
      return profile;
    });
  },

  onSaveProfile() {
    if (this.data.loading) return Promise.resolve();
    const nickname = this.data.nicknameDraft.trim();
    if (!nickname) {
      wx.showToast({ title: '请填写昵称', icon: 'none' });
      return Promise.resolve();
    }
    this.setData({ loading: true });
    return this.uploadSelectedAvatar()
      .then(() => api.updateProfile({ nickname }))
      .then(profile => {
        this.applyProfile(profile);
        this.setData({ showProfilePrompt: false });
        wx.showToast({ title: '资料已保存', icon: 'success' });
      })
      .catch(() => {
        this.setData({
          nicknameDraft: nickname,
          showProfilePrompt: true,
        });
        wx.showToast({ title: '资料保存失败', icon: 'none' });
      })
      .finally(() => this.setData({ loading: false }));
  },

  onSkipProfile() {
    this.setData({ loading: true });
    return api.skipProfilePrompt()
      .then(profile => {
        this.applyProfile(profile);
        this.setData({ showProfilePrompt: false });
      })
      .catch(() => wx.showToast({ title: '操作失败，请重试', icon: 'none' }))
      .finally(() => this.setData({ loading: false }));
  },

  onStudentNameBlur(e) {
    const studentName = e.detail.value.trim();
    if (!studentName || studentName === this.data.studentName) return;
    api.updateProfile({ student_name: studentName })
      .then(profile => this.applyProfile(profile))
      .catch(() => wx.showToast({ title: '学生称呼保存失败', icon: 'none' }));
  },

  onGradeChange(e) {
    const gradeIndex = Number(e.detail.value);
    api.updateProfile({ grade: gradeIndex + 1 })
      .then(profile => this.applyProfile(profile))
      .catch(() => wx.showToast({ title: '年级保存失败', icon: 'none' }));
  },

  onSemesterChange(e) {
    const semester = Number(e.detail.value);
    api.updateProfile({ semester: semester + 1 })
      .then(profile => this.applyProfile(profile))
      .catch(() => wx.showToast({ title: '册别保存失败', icon: 'none' }));
  },

  onStatTap(e) {
    const filters = {
      total: { label: '全部错题' },
      month: {
        label: '本月新增',
        created_from: getBeijingMonthStart(),
      },
      needsReview: {
        label: '待复习',
        status: 'needs_review',
      },
      mastered: {
        label: '已掌握',
        mastery_status: 'mastered',
      },
    };
    const filter = filters[e.currentTarget.dataset.filter];
    if (!filter) return;
    wx.setStorageSync('questionEntryFilter', filter);
    wx.switchTab({ url: '/pages/questions/questions' });
  },

  onLogout() {
    session.logoutLocal({ manual: true, redirect: true });
  },
});

module.exports = { getBeijingMonthStart };
