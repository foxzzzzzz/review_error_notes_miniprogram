const { SERVER_BASE } = require('./config');
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
  if (data && typeof data === 'object' && data.detail) return data.detail;
  return `请求失败 (${statusCode})`;
};

const handleUnauthorized = () => {
  wx.removeStorageSync('token');
  wx.removeStorageSync('studentId');
  wx.reLaunch({ url: '/pages/profile/profile' });
};

const request = (url, options = {}) => {
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
        if (res.statusCode === 401) {
          handleUnauthorized();
        }
        reject(new ApiError(errorMessage(res.data, res.statusCode), res.statusCode, res.data));
      },
      fail: reject,
    });
  });
};

module.exports = {
  login: (code) => request('/auth/login', { method: 'POST', data: { code } }),
  bindPhone: (code) => request('/auth/bind-phone', { method: 'POST', data: { code } }),
  uploadImage: (filePath, metadata = {}) => new Promise((resolve, reject) => {
    wx.uploadFile({
      url: BASE_URL + '/upload/image',
      filePath,
      name: 'file',
      formData: metadata,
      header: { 'Authorization': `Bearer ${wx.getStorageSync('token')}` },
      success(res) {
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
        if (res.statusCode === 401) handleUnauthorized();
        reject(new ApiError(errorMessage(data, res.statusCode), res.statusCode, data));
      },
      fail: reject,
    });
  }),
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
  deleteQuestion: (id) => request(`/questions/${id}`, { method: 'DELETE' }),
  getProfile: () => request('/profile'),
  updateProfile: (data) => request('/profile', { method: 'PATCH', data }),
  resolveServerUrl,
  ApiError,
};
