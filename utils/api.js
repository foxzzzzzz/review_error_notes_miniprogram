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
  const recoveryRequest = options.authScope === 'recovery';
  const token = wx.getStorageSync(
    recoveryRequest ? 'recoveryToken' : 'token'
  );
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
        if (res.statusCode === 401 && !retried && !recoveryRequest) {
          session.retryAfterUnauthorized(() => request(url, options, true))
            .then(resolve, reject);
          return;
        }
        if (res.statusCode === 401) terminalUnauthorized();
        reject(new ApiError(errorMessage(res.data, res.statusCode), res.statusCode, res.data));
      },
      fail(error) {
        const errMsg = String(error && error.errMsg ? error.errMsg : '');
        const message = /timeout/i.test(errMsg)
          ? '请求超时，后台可能仍在生成，请稍后查看历史错题集'
          : '网络连接失败，请稍后重试';
        reject(new ApiError(message, 0, error || null));
      },
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

const getImageStatuses = (imageIds) => {
  const query = imageIds
    .map(imageId => `image_ids=${encodeURIComponent(imageId)}`)
    .join('&');
  return request(`/upload/images/status?${query}`);
};

const retryImage = imageId => (
  request(`/upload/images/${encodeURIComponent(imageId)}/retry`, { method: 'POST' })
);

const downloadAvatar = (_path) => (
  new Promise((resolve, reject) => {
    wx.downloadFile({
      url: `${BASE_URL}/profile/avatar`,
      header: { 'Authorization': `Bearer ${wx.getStorageSync('token') || ''}` },
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

const downloadSheet = (sheetId) => (
  new Promise((resolve, reject) => {
    wx.downloadFile({
      url: `${BASE_URL}/sheets/${encodeURIComponent(sheetId)}/pdf`,
      header: { 'Authorization': `Bearer ${wx.getStorageSync('token') || ''}` },
      success(res) {
        if (res.statusCode >= 200 && res.statusCode < 300 && res.tempFilePath) {
          resolve(res.tempFilePath);
          return;
        }
        reject(new ApiError(`错题集加载失败 (${res.statusCode || 0})`, res.statusCode || 0));
      },
      fail() { reject(new ApiError('错题集加载失败', 0)); },
    });
  })
);

module.exports = {
  login: (code) => request('/auth/login', { method: 'POST', data: { code } }),
  devLogin: (code) => request('/auth/dev-login', { method: 'POST', data: { code } }),
  bindPhone: (code) => request('/auth/bind-phone', { method: 'POST', data: { code } }),
  recoverAccount: (recoveryToken) => request('/auth/recover-account', {
    method: 'POST',
    data: { recovery_token: recoveryToken },
  }),
  logoutAccount: () => request('/account/logout', { method: 'POST' }),
  requestAccountDeletion: (loginCode) => request('/account/deletion', {
    method: 'POST',
    data: { code: loginCode },
  }),
  recoverDeletedAccount: () => request('/account/deletion/recover', {
    method: 'POST',
    authScope: 'recovery',
  }),
  uploadImage,
  getImageStatuses,
  retryImage,
  listQuestions: (params = {}) => {
    const qs = Object.keys(params)
      .filter(k => params[k] != null)
      .map(k => encodeURIComponent(k) + '=' + encodeURIComponent(params[k]))
      .join('&');
    return request('/questions' + (qs ? '?' + qs : ''));
  },
  getQuestion: (id) => request(`/questions/${id}`),
  listReviewImages: () => request('/questions/review/images'),
  decideImageReviews: (imageId, decisions) => request(
    `/questions/review/images/${encodeURIComponent(imageId)}/decisions`,
    { method: 'POST', data: { decisions } }
  ),
  reprocessReviewImage: (imageId, correction) => request(
    `/questions/review/images/${encodeURIComponent(imageId)}/reprocess`,
    { method: 'POST', data: { correction } }
  ),
  updateQuestion: (id, data) => request(`/questions/${id}`, { method: 'PATCH', data }),
  createSheet: (data) => request('/sheets', { method: 'POST', data }),
  listSheets: () => request('/sheets'),
  getSheetGeneration: (id) => request(`/sheets/${id}/generation`),
  retrySheetGeneration: (id) => request(`/sheets/${id}/retry`, { method: 'POST' }),
  deleteSheet: (id) => request(`/sheets/${id}`, { method: 'DELETE' }),
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
  downloadSheet,
  downloadQuestionImage,
  resolveServerUrl,
  ApiError,
};
