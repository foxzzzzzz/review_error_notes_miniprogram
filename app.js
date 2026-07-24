const session = require('./utils/session');

App({
  onLaunch() {
    session.login().then(data => {
      if (data && data.account_status === 'pending_deletion') {
        wx.reLaunch({ url: '/pages/profile/profile' });
      }
    }).catch(() => {
      wx.showToast({ title: '登录失败', icon: 'none' });
    });
  },
});
