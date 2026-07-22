const { DEV_MODE } = require('./utils/config');

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
    const api = require('./utils/api');
    if (DEV_MODE) {
      const devId = 'dev_' + Date.now();
      api.devLogin(devId).then(data => {
        wx.setStorageSync('token', data.token);
        wx.setStorageSync('studentId', data.student_id);
        if (data.need_phone) {
          wx.navigateTo({ url: '/pages/profile/profile?action=bindPhone' });
        }
      }).catch(() => wx.showToast({ title: '登录失败', icon: 'none' }));
      return;
    }
    wx.login({
      success: (res) => {
        api.login(res.code).then(data => {
          wx.setStorageSync('token', data.token);
          wx.setStorageSync('studentId', data.student_id);
          if (data.need_phone) {
            wx.navigateTo({ url: '/pages/profile/profile?action=bindPhone' });
          }
        }).catch(() => wx.showToast({ title: '登录失败', icon: 'none' }));
      },
      fail: () => wx.showToast({ title: '登录失败', icon: 'none' }),
    });
  }
});
