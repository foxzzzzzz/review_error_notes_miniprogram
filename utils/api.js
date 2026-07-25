const { SERVER_BASE } = require('./config');
const session = require('./session');

const BASE_URL = SERVER_BASE + '/api';

const resolveServerUrl = (path) => {
  if (!path) return '';
  if (path.startsWith('http')) return path;
  return SERVER_BASE + path;
};

class ApiError extends Error {
  constructor(message, statusCode = 0, data = null) {
    super(message);
    this.name = 'ApiError';
    this.statusCode = statusCode;
    this.data = data;
  }
}

const errorMessage = (data, statusCode) => {
  if (data && typeof data === 'object' && data.detail) {
    if (typeof data.detail === 'string') return data.detail;
    if (data.detail.message) return data.detail.message;
  }
  return `请求失败 (${statusCode})`;
};

const terminalUnauthorized = () => {
  session.logoutLocal({ manual: false, redirect: true });
};

const request = (url, options = {}, retried = false) => {
  const token = wx.getStorageSync('token');
  return new Promise((resolve, reject) => {
    wx.request({
      url: BASE_URL + url,
      method: options.method || 'GET',
      data: options.data,
      header: {
        'Content-Type': 'application/json',
        'Authorization': token ? `Bearer ${token}` : '',
      },
      success(res) {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(res.data);
          return;
        }
        if (res.statusCode === 401 && !retried) {
          session.retryAfterUnauthorized(() => request(url, options, true))
            .then(resolve, reject);
          return;
        }
        if (res.statusCode === 401) terminalUnauthorized();
        reject(new ApiError(errorMessage(res.data, res.statusCode), res.statusCode, res.data));
      },
      fail: reject,
    });
  });
};

const downloadQuestionImage = (questionId, view = 'crop', retried = false) => (
  new Promise((resolve, reject) => {
    wx.downloadFile({
      url: `${BASE_URL}/questions/${encodeURIComponent(questionId)}/image?view=${encodeURIComponent(view)}`,
      header: { 'Authorization': `Bearer ${wx.getStorageSync('token') || ''}` },
      success(res) {
        if (res.statusCode >= 200 && res.statusCode < 300 && res.tempFilePath) {
          resolve(res.tempFilePath);
          return;
        }
        if (res.statusCode === 401 && !retried) {
          session.retryAfterUnauthorized(
            () => downloadQuestionImage(questionId, view, true)
          ).then(resolve, reject);
          return;
        }
        if (res.statusCode === 401) terminalUnauthorized();
        reject(new ApiError(`图片加载失败 (${res.statusCode || 0})`, res.statusCode || 0));
      },
      fail() {
        reject(new ApiError('图片加载失败', 0));
      },
    });
  })
);

const uploadImage = (filePath, metadata = {}, retried = false) => (
  new Promise((resolve, reject) => {
    wx.uploadFile({
      url: BASE_URL + '/upload/image',
      filePath,
      name: 'file',
      formData: metadata,
      header: { 'Authorization': `Bearer ${wx.getStorageSync('token') || ''}` },
      success(res) {
        if (res.statusCode === 401 && !retried) {
          session.retryAfterUnauthorized(
            () => uploadImage(filePath, metadata, true)
          ).then(resolve, reject);
          return;
        }
        if (res.statusCode === 401) {
          terminalUnauthorized();
          reject(new ApiError('登录已失效', 401));
          return;
        }
        let data;
        try {
          data = JSON.parse(res.data);
        } catch (_error) {
          reject(new ApiError('服务器返回了无效数据', res.statusCode));
          return;
        }
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(data);
          return;
        }
        reject(new ApiError(errorMessage(data, res.statusCode), res.statusCode, data));
      },
      fail: reject,
    });
  })
);

const uploadAvatar = (filePath, retried = false) => (
  new Promise((resolve, reject) => {
    wx.uploadFile({
      url: BASE_URL + '/profile/avatar',
      filePath,
      name: 'file',
      header: { 'Authorization': `Bearer ${wx.getStorageSync('token') || ''}` },
      success(res) {
        if (res.statusCode === 401 && !retried) {
          session.retryAfterUnauthorized(
            () => uploadAvatar(filePath, true)
          ).then(resolve, reject);
          return;
        }
        if (res.statusCode === 401) {
          terminalUnauthorized();
          reject(new ApiError('登录已失效', 401));
          return;
        }
        let data;
        try {
          data = JSON.parse(res.data);
        } catch (_error) {
          reject(new ApiError('服务器返回了无效数据', res.statusCode));
          return;
        }
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(data);
          return;
        }
        reject(new ApiError(errorMessage(data, res.statusCode), res.statusCode, data));
      },
      fail: reject,
    });
  })
);

const downloadAvatar = (path) => (
  new Promise((resolve, reject) => {
    wx.downloadFile({
      url: resolveServerUrl(path),
      success(res) {
        if (res.statusCode >= 200 && res.statusCode < 300 && res.tempFilePath) {
          resolve(res.tempFilePath);
          return;
        }
        reject(new ApiError(
          `头像加载失败 (${res.statusCode || 0})`,
          res.statusCode || 0
        ));
      },
      fail() {
        reject(new ApiError('头像加载失败', 0));
      },
    });
  })
);

module.exports = {
  login: (code) => request('/auth/login', { method: 'POST', data: { code } }),
  devLogin: (code) => request('/auth/dev-login', { method: 'POST', data: { code } }),
  bindPhone: (code) => request('/auth/bind-phone', { method: 'POST', data: { code } }),
  uploadImage,
  listQuestions: (params = {}) => {
    const qs = Object.keys(params)
      .filter(k => params[k] != null)
      .map(k => encodeURIComponent(k) + '=' + encodeURIComponent(params[k]))
      .join('&');
    return request('/questions' + (qs ? '?' + qs : ''));
  },
  getQuestion: (id) => request(`/questions/${id}`),
  updateQuestion: (id, data) => request(`/questions/${id}`, { method: 'PATCH', data }),
  createSheet: (data) => request('/sheets', { method: 'POST', data }),
  listSheets: () => request('/sheets'),
  getSheetReview: (id) => request(`/sheets/${id}/review`),
  listSheetAttempts: (id) => request(`/sheets/${id}/attempts`),
  createSheetAttempt: (id, data) => (
    request(`/sheets/${id}/attempts`, { method: 'POST', data })
  ),
  updateSheetAttempt: (sheetId, attemptId, data) => (
    request(`/sheets/${sheetId}/attempts/${attemptId}`, {
      method: 'PATCH',
      data,
    })
  ),
  deleteQuestion: (id) => request(`/questions/${id}`, { method: 'DELETE' }),
  getProfile: () => request('/profile'),
  updateProfile: (data) => request('/profile', { method: 'PATCH', data }),
  skipProfilePrompt: () => request('/profile/prompt/skip', { method: 'POST' }),
  uploadAvatar,
  downloadAvatar,
  downloadQuestionImage,
  resolveServerUrl,
  ApiError,
};
