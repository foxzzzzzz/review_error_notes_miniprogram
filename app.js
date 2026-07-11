App({
  onLaunch() {
    this.checkLogin();
  },
  checkLogin() {
    const token = wx.getStorageSync('token');
    if (!token) {
      this.doLogin();
    }
  },
  doLogin() {
    wx.login({
      success: (res) => {
        const api = require('./utils/api');
        api.login(res.code).then(data => {
          wx.setStorageSync('token', data.token);
          wx.setStorageSync('studentId', data.student_id);
          if (data.need_phone) {
            wx.navigateTo({ url: '/pages/profile/profile?action=bindPhone' });
          }
        });
      }
    });
  }
});
