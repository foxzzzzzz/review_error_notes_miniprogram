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

const getErrorDetail = error => (
  error && error.data && error.data.detail && typeof error.data.detail === 'object'
    ? error.data.detail
    : {}
);

const phoneAuthorizationMessage = (errMsg = '') => {
  const message = String(errMsg).toLowerCase();
  if (message.includes('user deny') || message.includes('user cancel')) {
    return '已取消手机号授权';
  }
  if (message.includes('no permission') || message.includes('permission denied')) {
    return '当前小程序未开通手机号能力';
  }
  if (message.includes('not support')) {
    return '当前微信环境不支持手机号授权';
  }
  return '手机号授权失败，请稍后重试';
};

const formatDeletionDueAt = value => {
  if (!value) return '';
  const text = String(value);
  const date = new Date(
    /(?:Z|[+-]\d{2}:?\d{2})$/i.test(text) ? text : `${text}Z`
  );
  if (Number.isNaN(date.getTime())) return '';
  const beijing = new Date(date.getTime() + 8 * 60 * 60 * 1000);
  return [
    beijing.getUTCFullYear(),
    pad(beijing.getUTCMonth() + 1),
    pad(beijing.getUTCDate()),
  ].join('-') + ' ' + [
    pad(beijing.getUTCHours()),
    pad(beijing.getUTCMinutes()),
  ].join(':');
};

Page({
  data: {
    loggedIn: false,
    pendingDeletion: false,
    deletionDueText: '',
    deletionConfirming: false,
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
    const manualLogout = wx.getStorageSync('manualLogout') === true;
    const pendingDeletion = !manualLogout
      && wx.getStorageSync('accountStatus') === 'pending_deletion'
      && Boolean(wx.getStorageSync('recoveryToken'));
    const loggedIn = !manualLogout && (
      Boolean(wx.getStorageSync('token')) || pendingDeletion
    );
    this.setData({
      loggedIn,
      pendingDeletion,
      deletionDueText: pendingDeletion
        ? formatDeletionDueAt(wx.getStorageSync('deletionDueAt'))
        : '',
      showProfilePrompt: pendingDeletion ? false : this.data.showProfilePrompt,
    });
    if (!loggedIn) return Promise.resolve();
    if (pendingDeletion) return Promise.resolve();
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
      .then(login => {
        const pendingDeletion = login
          && login.account_status === 'pending_deletion';
        this.setData({
          loggedIn: true,
          pendingDeletion,
          deletionDueText: pendingDeletion
            ? formatDeletionDueAt(login.deletion_due_at)
            : '',
        });
        if (pendingDeletion) return null;
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

  onGetPhoneNumber(e) {
    const detail = e && e.detail ? e.detail : {};
    const code = detail.code;
    if (!code) {
      console.warn('[getPhoneNumber] authorization failed', detail);
      wx.showToast({
        title: phoneAuthorizationMessage(detail.errMsg),
        icon: 'none',
      });
      return Promise.resolve();
    }
    this.setData({ loading: true });
    return api.bindPhone(code)
      .then(result => {
        this.setData({
          phoneBound: true,
          phoneMasked: result.phone_masked || '',
        });
        wx.setStorageSync('phoneBound', true);
        wx.setStorageSync('phoneMasked', result.phone_masked || '');
        wx.showToast({ title: '手机号已绑定', icon: 'success' });
      })
      .catch(error => this.handlePhoneConflict(error))
      .finally(() => this.setData({ loading: false }));
  },

  handlePhoneConflict(error) {
    const detail = getErrorDetail(error);
    if (detail.code === 'account_recovery_available') {
      return showModal({
        title: '发现已有账户',
        content: detail.message || '该手机号关联了已有账户，是否恢复原账户？',
        confirmText: '恢复账户',
        cancelText: '暂不恢复',
      }).then(result => {
        if (!result.confirm) return null;
        return api.recoverAccount(detail.recovery_token)
          .then(login => {
            session.storeLogin(login);
            this.setData({ pendingDeletion: false });
            return this.loadProfile();
          });
      }).catch(() => {
        wx.showToast({ title: '账户恢复失败，请重试', icon: 'none' });
      });
    }
    if (detail.code === 'account_merge_required') {
      const reference = detail.support_reference
        ? `\n处理编号：${detail.support_reference}`
        : '';
      return showModal({
        title: '需要人工合并',
        content: `${detail.message || '两个账户均有学习数据，请联系支持处理'}${reference}`,
        showCancel: false,
        confirmText: '我知道了',
      });
    }
    wx.showToast({ title: error.message || '手机号绑定失败', icon: 'none' });
    return Promise.resolve();
  },

  onLogout() {
    return api.logoutAccount()
      .catch(() => null)
      .finally(() => {
        session.logoutLocal({ manual: true, redirect: true });
      });
  },

  onRequestDeletion() {
    if (this.data.loading || this.data.deletionConfirming) return Promise.resolve();
    this.setData({ deletionConfirming: true });
    return showModal({
      title: '申请注销账户？',
      content: '注销后将退出错题本，账户和学习数据会在保留期内暂存。在此期间可随时恢复。',
      confirmText: '继续注销',
      confirmColor: '#c8453d',
      cancelText: '取消',
    }).then(first => {
      if (!first.confirm) return null;
      return showModal({
        title: '再次确认注销',
        content: '保留期结束后，账户、错题、练习和头像将被永久删除，且无法恢复。',
        confirmText: '确认注销',
        confirmColor: '#c8453d',
        cancelText: '我再想想',
      });
    }).then(second => {
      if (!second || !second.confirm) return null;
      this.setData({ loading: true });
      return session.getFreshLoginCode()
        .then(code => api.requestAccountDeletion(code))
        .then(result => {
          session.storePendingDeletion(result);
          this.setData({
            loggedIn: true,
            pendingDeletion: true,
            deletionDueText: formatDeletionDueAt(result.deletion_due_at),
            showProfilePrompt: false,
          });
        })
        .catch(() => {
          wx.showToast({ title: '注销申请失败，请重试', icon: 'none' });
        })
        .finally(() => this.setData({ loading: false }));
    }).finally(() => this.setData({ deletionConfirming: false }));
  },

  onRecoverDeletion() {
    if (this.data.loading) return Promise.resolve();
    this.setData({ loading: true });
    return api.recoverDeletedAccount()
      .then(login => {
        session.storeLogin(login);
        this.setData({
          pendingDeletion: false,
          deletionDueText: '',
        });
        return this.loadProfile();
      })
      .then(() => wx.showToast({ title: '账户已恢复', icon: 'success' }))
      .catch(() => wx.showToast({ title: '账户恢复失败，请重试', icon: 'none' }))
      .finally(() => this.setData({ loading: false }));
  },

  onExitPendingAccount() {
    session.logoutLocal({ manual: true, redirect: true });
  },
});

module.exports = {
  getBeijingMonthStart,
  formatDeletionDueAt,
  phoneAuthorizationMessage,
};
