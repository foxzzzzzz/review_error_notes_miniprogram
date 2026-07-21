const SERVER_BASE = 'https://your-server.com';
const BASE_URL = SERVER_BASE + '/api';

const resolveServerUrl = (path) => {
  if (!path) return '';
  if (path.startsWith('http')) return path;
  return SERVER_BASE + path;
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
        if (res.statusCode === 401) {
          wx.removeStorageSync('token');
          wx.reLaunch({ url: '/pages/profile/profile' });
          reject(new Error('Unauthorized'));
          return;
        }
        resolve(res.data);
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
      success(res) { resolve(JSON.parse(res.data)); },
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
};
