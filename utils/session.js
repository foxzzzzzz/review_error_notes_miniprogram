const config = require('./config');

const BASE_URL = config.SERVER_BASE + '/api';
const DEV_MODE = config.DEV_MODE === true;
const DEV_LOGIN_IDENTITY = config.DEV_LOGIN_IDENTITY || 'dev-local-account';

let loginPromise = null;

const storeLogin = (data) => {
  wx.setStorageSync('token', data.token);
  wx.setStorageSync('accountId', data.account_id);
  wx.setStorageSync('studentId', data.student_id);
  wx.setStorageSync('manualLogout', false);
  return data;
};

const clearSession = () => {
  wx.removeStorageSync('token');
  wx.removeStorageSync('accountId');
  wx.removeStorageSync('studentId');
};

const requestLogin = (path, code) => new Promise((resolve, reject) => {
  wx.request({
    url: BASE_URL + path,
    method: 'POST',
    data: { code },
    header: { 'Content-Type': 'application/json' },
    success(res) {
      if (res.statusCode >= 200 && res.statusCode < 300) {
        resolve(storeLogin(res.data));
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

const logoutLocal = ({ manual = true, redirect = true } = {}) => {
  clearSession();
  wx.setStorageSync('manualLogout', manual);
  if (redirect) {
    wx.reLaunch({ url: '/pages/profile/profile' });
  }
};

const retryAfterUnauthorized = async (runRequest) => {
  wx.removeStorageSync('token');
  try {
    await login({ force: true });
    return await runRequest();
  } catch (error) {
    logoutLocal({ manual: false, redirect: true });
    throw error;
  }
};

module.exports = {
  login,
  retryAfterUnauthorized,
  logoutLocal,
};
