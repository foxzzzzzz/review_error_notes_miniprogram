const BASE_URL = 'https://your-server.com/api';

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
  bindPhone: (encryptedData, iv) => request('/auth/bind-phone', { method: 'POST', data: { encrypted_data: encryptedData, iv } }),
  uploadImage: (filePath) => new Promise((resolve, reject) => {
    wx.uploadFile({
      url: BASE_URL + '/upload/image',
      filePath,
      name: 'file',
      header: { 'Authorization': `Bearer ${wx.getStorageSync('token')}` },
      success(res) { resolve(JSON.parse(res.data)); },
      fail: reject,
    });
  }),
  listQuestions: (params = {}) => request('/questions?' + new URLSearchParams(params).toString()),
  updateQuestion: (id, data) => request(`/questions/${id}`, { method: 'PATCH', data }),
  createSheet: (data) => request('/sheets', { method: 'POST', data }),
  listSheets: () => request('/sheets'),
  deleteQuestion: (id) => request(`/questions/${id}`, { method: 'DELETE' }),
};
