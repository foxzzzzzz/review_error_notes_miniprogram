const config = require('./config');

const BASE_URL = config.SERVER_BASE + '/api';
const DEV_MODE = config.DEV_MODE === true;
const DEV_LOGIN_IDENTITY = config.DEV_LOGIN_IDENTITY || 'dev-local-account';

let loginPromise = null;

const storeLogin = (data) => {
  wx.setStorageSync('token', data.token);
  wx.removeStorageSync('recoveryToken');
  wx.removeStorageSync('deletionDueAt');
  wx.setStorageSync('accountId', data.account_id);
  wx.setStorageSync('studentId', data.student_id);
  wx.setStorageSync('profilePromptRequired', data.profile_prompt_required === true);
  wx.setStorageSync('studentProfileRequired', data.student_profile_required === true);
  wx.setStorageSync('accountStatus', data.account_status || '');
  wx.setStorageSync('manualLogout', false);
  return data;
};

const storePendingDeletion = (data) => {
  wx.removeStorageSync('token');
  wx.setStorageSync('recoveryToken', data.recovery_token);
  wx.setStorageSync('accountId', data.account_id || wx.getStorageSync('accountId'));
  wx.setStorageSync('studentId', data.student_id || wx.getStorageSync('studentId'));
  wx.setStorageSync('accountStatus', 'pending_deletion');
  wx.setStorageSync('deletionDueAt', data.deletion_due_at || '');
  wx.setStorageSync('profilePromptRequired', false);
  wx.setStorageSync('studentProfileRequired', false);
  wx.setStorageSync('manualLogout', false);
  return data;
};

const clearSession = () => {
  wx.removeStorageSync('token');
  wx.removeStorageSync('recoveryToken');
  wx.removeStorageSync('accountId');
  wx.removeStorageSync('studentId');
  wx.removeStorageSync('profilePromptRequired');
  wx.removeStorageSync('studentProfileRequired');
  wx.removeStorageSync('accountStatus');
  wx.removeStorageSync('deletionDueAt');
};

const requestLogin = (path, code) => new Promise((resolve, reject) => {
  wx.request({
    url: BASE_URL + path,
    method: 'POST',
    data: { code },
    header: { 'Content-Type': 'application/json' },
    success(res) {
      if (res.statusCode >= 200 && res.statusCode < 300) {
        resolve(
          res.data.account_status === 'pending_deletion'
            ? storePendingDeletion(res.data)
            : storeLogin(res.data)
        );
        return;
      }
      reject(new Error('登录失败'));
    },
    fail: reject,
  });
});

const wechatLogin = () => new Promise((resolve, reject) => {
  wx.login({
    success(res) {
      if (!res.code) {
        reject(new Error('登录失败'));
        return;
      }
      requestLogin('/auth/login', res.code).then(resolve, reject);
    },
    fail: reject,
  });
});

const login = ({ force = false } = {}) => {
  if (!force && wx.getStorageSync('manualLogout')) {
    return Promise.resolve(null);
  }
  if (!force && wx.getStorageSync('token')) {
    return Promise.resolve({
      token: wx.getStorageSync('token'),
      account_id: wx.getStorageSync('accountId'),
      student_id: wx.getStorageSync('studentId'),
      profile_prompt_required: wx.getStorageSync('profilePromptRequired') === true,
      student_profile_required: wx.getStorageSync('studentProfileRequired') === true,
      account_status: wx.getStorageSync('accountStatus') || '',
    });
  }
  if (
    !force
    && wx.getStorageSync('accountStatus') === 'pending_deletion'
    && wx.getStorageSync('recoveryToken')
  ) {
    return Promise.resolve({
      token: null,
      recovery_token: wx.getStorageSync('recoveryToken'),
      account_id: wx.getStorageSync('accountId'),
      student_id: wx.getStorageSync('studentId'),
      account_status: 'pending_deletion',
      deletion_due_at: wx.getStorageSync('deletionDueAt') || '',
    });
  }
  if (loginPromise) return loginPromise;

  loginPromise = (
    DEV_MODE
      ? requestLogin('/auth/dev-login', DEV_LOGIN_IDENTITY)
      : wechatLogin()
  ).finally(() => {
    loginPromise = null;
  });
  return loginPromise;
};

const getFreshLoginCode = () => new Promise((resolve, reject) => {
  wx.login({
    success(res) {
      if (!res.code) {
        reject(new Error('身份验证失败'));
        return;
      }
      resolve(DEV_MODE ? DEV_LOGIN_IDENTITY : res.code);
    },
    fail: reject,
  });
});

const logoutLocal = ({ manual = true, redirect = true } = {}) => {
  clearSession();
  wx.setStorageSync('manualLogout', manual);
  if (redirect) {
    wx.reLaunch({ url: '/pages/profile/profile' });
  }
};

const retryAfterUnauthorized = async (runRequest) => {
  if (wx.getStorageSync('manualLogout') === true) {
    const error = new Error('manual logout');
    error.code = 'manual_logout';
    throw error;
  }
  wx.removeStorageSync('token');
  try {
    const loginResult = await login({ force: true });
    if (loginResult && loginResult.account_status === 'pending_deletion') {
      wx.reLaunch({ url: '/pages/profile/profile' });
      const error = new Error('account pending deletion');
      error.code = 'account_pending_deletion';
      throw error;
    }
    return await runRequest();
  } catch (error) {
    if (error.code === 'account_pending_deletion') throw error;
    logoutLocal({ manual: false, redirect: true });
    throw error;
  }
};

module.exports = {
  login,
  retryAfterUnauthorized,
  logoutLocal,
  storeLogin,
  storePendingDeletion,
  getFreshLoginCode,
};
