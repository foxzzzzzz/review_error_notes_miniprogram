const api = require('../../utils/api');

Page({
  data: {
    gradeIndex: 0,
    semester: 0,
    gradeSet: false,
    semesterSet: false,
    settingsGradeIndex: 0,
    settingsSemester: 0,
    showStudentSettings: false,
    resumeSubmitAfterSettings: false,
    grades: ['一年级','二年级','三年级','四年级','五年级','六年级'],
    semesters: ['上册','下册'],
    previewUrl: '',
    uploads: [],
    uploading: false,
    batchSubject: null,
    subjectMap: { math: '数学', chinese: '语文', english: '英语' },
    statusText: {
      pending: '排队处理中',
      segmented: '识别处理中',
      confirmed: '处理完成',
      needs_review: '处理完成（待确认）',
      failed: '处理异常',
    },
  },
  statusPollingTimer: null,
  statusPollingGeneration: 0,
  onShow() {
    if (!wx.getStorageSync('token') || wx.getStorageSync('manualLogout')) {
      return Promise.resolve();
    }
    return api.getProfile()
      .then(profile => {
        this.applyStudentProfile(profile);
        return this.startStatusPolling();
      })
      .catch(() => wx.showToast({ title: '学生设置加载失败', icon: 'none' }));
  },
  onHide() {
    this.stopStatusPolling();
  },
  onUnload() {
    this.stopStatusPolling();
  },
  applyStudentProfile(profile) {
    const gradeSet = Number.isInteger(profile.grade);
    const semesterSet = Number.isInteger(profile.semester);
    const gradeIndex = gradeSet ? profile.grade - 1 : 0;
    const semester = semesterSet ? profile.semester - 1 : 0;
    if (gradeSet) wx.setStorageSync('grade', gradeIndex);
    if (semesterSet) wx.setStorageSync('semester', semester);
    wx.setStorageSync(
      'studentProfileRequired',
      profile.student_profile_required === true
    );
    this.setData({
      gradeIndex,
      semester,
      gradeSet,
      semesterSet,
      settingsGradeIndex: gradeIndex,
      settingsSemester: semester,
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
          subject: this.data.batchSubject,
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
  onBatchSubjectTap() {
    const subjects = ['math', 'chinese', 'english'];
    const subjectNames = ['数学', '语文', '英语'];
    wx.showActionSheet({
      itemList: subjectNames,
      success: (res) => {
        const subject = subjects[res.tapIndex];
        this.setData({
          batchSubject: subject,
          uploads: this.data.uploads.map(item => ({ ...item, subject })),
        });
      },
    });
  },
  hasActiveImageStatuses() {
    return this.data.uploads.some(item => (
      item.imageId && (item.status === 'pending' || item.status === 'segmented')
    ));
  },
  refreshImageStatuses() {
    const activeImageIds = this.data.uploads
      .filter(item => item.imageId && (item.status === 'pending' || item.status === 'segmented'))
      .map(item => item.imageId);
    if (!activeImageIds.length) return Promise.resolve([]);
    return api.getImageStatuses(activeImageIds).then(statuses => {
      const statusesById = new Map(statuses.map(item => [item.image_id, item]));
      const uploads = this.data.uploads.map(item => {
        const status = statusesById.get(item.imageId);
        if (!status) return item;
        return {
          ...item,
          status: status.status,
          questionCount: status.question_count,
          errorCode: status.error_code,
          errorMessage: status.error_message,
        };
      });
      this.setData({ uploads });
      return statuses;
    });
  },
  stopStatusPolling() {
    this.statusPollingGeneration += 1;
    if (this.statusPollingTimer) {
      clearTimeout(this.statusPollingTimer);
      this.statusPollingTimer = null;
    }
  },
  startStatusPolling() {
    this.stopStatusPolling();
    const generation = this.statusPollingGeneration;
    return this.refreshImageStatuses()
      .catch(() => [])
      .then(statuses => {
        if (generation === this.statusPollingGeneration && this.hasActiveImageStatuses()) {
          this.statusPollingTimer = setTimeout(() => this.startStatusPolling(), 3000);
        }
        return statuses;
      });
  },
  onRetryTap(e) {
    const index = e.currentTarget.dataset.index;
    const image = this.data.uploads[index];
    if (!image || !image.imageId || image.status !== 'failed') return Promise.resolve();
    return api.retryImage(image.imageId).then(result => {
      this.setData({
        [`uploads[${index}].status`]: result.status,
        [`uploads[${index}].errorCode`]: null,
        [`uploads[${index}].errorMessage`]: null,
      });
      return this.startStatusPolling();
    }).catch(() => {
      wx.showToast({ title: '重试失败，请稍后再试', icon: 'none' });
    });
  },
  submitAll() {
    if (this.data.uploading) return Promise.resolve();
    if (!this.data.gradeSet || !this.data.semesterSet) {
      this.setData({
        showStudentSettings: true,
        resumeSubmitAfterSettings: true,
      });
      return Promise.resolve();
    }
    return this.uploadPending();
  },
  uploadPending() {
    this.setData({ uploading: true });
    const uploads = this.data.uploads;
    const promises = [];
    for (let i = 0; i < uploads.length; i++) {
      if (!uploads[i].imageId && (uploads[i].status === 'pending' || uploads[i].status === 'failed')) {
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
              [`uploads[${idx}].status`]: result.status || 'pending',
              [`uploads[${idx}].imageId`]: result.image_id,
            });
          }).catch(error => {
            this.setData({ [`uploads[${idx}].status`]: 'failed' });
            throw error;
          })
        );
      }
    }
    return Promise.all(promises).then(() => {
      this.startStatusPolling();
      wx.showToast({ title: '提交成功', icon: 'success' });
      this.setData({ uploading: false });
    }).catch(() => {
      this.setData({ uploading: false });
      wx.showToast({ title: '部分图片上传失败', icon: 'none' });
    });
  },
  onSettingsGradeChange(e) {
    this.setData({ settingsGradeIndex: Number(e.detail.value) });
  },
  onSettingsSemesterChange(e) {
    this.setData({ settingsSemester: Number(e.detail.value) });
  },
  onCloseStudentSettings() {
    this.setData({
      showStudentSettings: false,
      resumeSubmitAfterSettings: false,
    });
  },
  onSaveStudentSettings() {
    const resumeSubmit = this.data.resumeSubmitAfterSettings;
    this.setData({ uploading: true });
    return api.updateProfile({
      grade: this.data.settingsGradeIndex + 1,
      semester: this.data.settingsSemester + 1,
    }).then(profile => {
      this.applyStudentProfile(profile);
      this.setData({
        showStudentSettings: false,
        resumeSubmitAfterSettings: false,
        uploading: false,
      });
      if (resumeSubmit) return this.submitAll();
      return null;
    }).catch(() => {
      this.setData({ uploading: false });
      wx.showToast({ title: '学生设置保存失败', icon: 'none' });
    });
  },
});
