const session = require('./utils/session');

App({
  onLaunch() {
    session.login().then(data => {
      if (data && (
        data.account_status === 'pending_deletion'
        || data.profile_prompt_required
      )) {
        const prompt = data.profile_prompt_required ? '?prompt=1' : '';
        wx.reLaunch({ url: '/pages/profile/profile' + prompt });
      }
    }).catch(() => {
      wx.showToast({ title: '登录失败', icon: 'none' });
    });
  },
});
