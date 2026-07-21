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
    statusText: { pending: '待处理', processing: '识别中', confirmed: '完成', failed: '失败' },
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
    const uploads = this.data.uploads;
    const promises = [];
    for (let i = 0; i < uploads.length; i++) {
      if (uploads[i].status === 'pending' || uploads[i].status === 'failed') {
        const idx = i;  // capture original index
        const metadata = {
          grade: this.data.gradeIndex + 1,
          semester: this.data.semester + 1,
        };
        if (uploads[idx].subject) metadata.subject = uploads[idx].subject;
        this.setData({ [`uploads[${idx}].status`]: 'processing' });
        promises.push(
          api.uploadImage(uploads[idx].path, metadata).then(result => {
            this.setData({
              [`uploads[${idx}].status`]: 'confirmed',
              [`uploads[${idx}].imageId`]: result.image_id,
            });
          }).catch(error => {
            this.setData({ [`uploads[${idx}].status`]: 'failed' });
            throw error;
          })
        );
      }
    }
    Promise.all(promises).then(() => {
      wx.showToast({ title: '提交成功', icon: 'success' });
      this.setData({ uploading: false });
    }).catch(() => {
      this.setData({ uploading: false });
      wx.showToast({ title: '部分图片上传失败', icon: 'none' });
    });
  },
});
