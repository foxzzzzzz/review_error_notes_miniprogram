const api = require('../../utils/api');

Page({
  data: {
    gradeIndex: 0,
    semester: 0,
    grades: ['一年级','二年级','三年级','四年级','五年级','六年级'],
    semesters: ['上册','下册'],
    previewUrl: '',
    uploads: [],
    uploading: false,
    subjectMap: { math: '数学', chinese: '语文', english: '英语' },
    statusText: { pending: '待处理', processing: '识别中', confirmed: '完成' },
  },
  onShow() {
    this.setData({
      gradeIndex: wx.getStorageSync('grade') || 0,
      semester: wx.getStorageSync('semester') || 0,
    });
  },
  takePhoto() {
    wx.chooseMedia({
      count: 9,
      mediaType: ['image'],
      sourceType: ['camera', 'album'],
      success: (res) => {
        const newUploads = res.tempFiles.map((f, i) => ({
          id: Date.now() + '_' + i,
          path: f.tempFilePath,
          status: 'pending',
          subject: null,
        }));
        this.setData({
          uploads: [...this.data.uploads, ...newUploads],
          previewUrl: newUploads[0].path,
        });
      },
    });
  },
  onSubjectTap(e) {
    const index = e.currentTarget.dataset.index;
    const subjects = ['math', 'chinese', 'english'];
    const subjectNames = ['数学', '语文', '英语'];
    wx.showActionSheet({
      itemList: subjectNames,
      success: (res) => {
        this.setData({ [`uploads[${index}].subject`]: subjects[res.tapIndex] });
      },
    });
  },
  submitAll() {
    this.setData({ uploading: true });
    const promises = this.data.uploads
      .filter(u => u.status === 'pending')
      .map((u, i) => {
        this.setData({ [`uploads[${i}].status`]: 'processing' });
        return api.uploadImage(u.path).then(result => {
          this.setData({ [`uploads[${i}].status`]: 'confirmed', [`uploads[${i}].imageId`]: result.image_id });
        });
      });
    Promise.all(promises).then(() => {
      wx.showToast({ title: '提交成功', icon: 'success' });
      this.setData({ uploading: false });
    });
  },
});
