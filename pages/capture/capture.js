const api = require('../../utils/api');

const BACKGROUND_UPLOADS_KEY = 'captureBackgroundUploads';
const FAILURE_REASON_FALLBACK = '识别暂时失败，请稍后重试';
const isActiveStatus = status => ['pending', 'processing', 'segmented'].includes(status);
const backgroundUploadsStorageKey = () => {
  if (typeof wx === 'undefined' || typeof wx.getStorageSync !== 'function') {
    return BACKGROUND_UPLOADS_KEY;
  }
  const studentId = wx.getStorageSync('studentId');
  return studentId ? `${BACKGROUND_UPLOADS_KEY}:${studentId}` : BACKGROUND_UPLOADS_KEY;
};
const shouldKeepBackgroundUpload = upload => (
  Boolean(upload.imageId) && upload.status !== 'confirmed'
);

const mergeBackgroundUploads = (existing, additions) => {
  const byImageId = new Map(existing.map(item => [item.imageId, item]));
  additions.forEach(item => {
    if (shouldKeepBackgroundUpload(item)) byImageId.set(item.imageId, item);
  });
  return [...byImageId.values()].filter(shouldKeepBackgroundUpload);
};

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
    previewUploadId: '',
    uploads: [],
    backgroundUploads: [],
    showBackgroundUploads: false,
    uploading: false,
    batchSubject: null,
    subjectMap: { math: '数学', chinese: '语文', english: '英语' },
    statusText: {
      pending: '排队处理中',
      segmented: '识别处理中',
      confirmed: '处理完成',
      needs_review: '待确认',
      failed: '处理异常',
    },
  },
  statusPollingTimer: null,
  statusPollingGeneration: 0,
  onShow() {
    this.restoreBackgroundUploads();
    if (!wx.getStorageSync('token') || wx.getStorageSync('manualLogout')) {
      return Promise.resolve();
    }
    return api.getProfile()
      .then(profile => {
        this.applyStudentProfile(profile);
        return this.syncIncompleteImageStatuses()
          .catch(() => [])
          .then(() => this.refreshImageStatuses({ includeNeedsReview: true }))
          .catch(() => [])
          .then(() => this.startStatusPolling());
      })
      .catch(() => wx.showToast({ title: '学生设置加载失败', icon: 'none' }));
  },
  onHide() {
    this.stopStatusPolling();
  },
  onUnload() {
    this.stopStatusPolling();
    this.persistBackgroundUploads();
  },
  restoreBackgroundUploads() {
    const savedUploads = wx.getStorageSync(backgroundUploadsStorageKey());
    if (!Array.isArray(savedUploads)) return;
    this.setData({
      backgroundUploads: mergeBackgroundUploads(
        this.data.backgroundUploads,
        savedUploads
      ),
    });
  },
  persistBackgroundUploads() {
    if (typeof wx === 'undefined' || typeof wx.setStorageSync !== 'function') return;
    const uploadsToRestore = this.data.uploads.filter(item => item.imageId);
    wx.setStorageSync(
      backgroundUploadsStorageKey(),
      mergeBackgroundUploads(this.data.backgroundUploads, uploadsToRestore)
    );
  },
  syncIncompleteImageStatuses() {
    if (typeof api.listIncompleteImageStatuses !== 'function') return Promise.resolve([]);
    return api.listIncompleteImageStatuses().then(statuses => {
      const additions = statuses.map(status => ({
        imageId: status.image_id,
        status: status.status,
        questionCount: status.question_count,
        errorCode: status.error_code,
        errorMessage: status.error_message,
      }));
      this.setData({
        backgroundUploads: mergeBackgroundUploads(this.data.backgroundUploads, additions),
      });
      this.persistBackgroundUploads();
      return statuses;
    });
  },
  moveSubmittedUploadsToBackground() {
    const backgroundUploads = mergeBackgroundUploads(
      this.data.backgroundUploads,
      this.data.uploads.filter(item => item.imageId)
    );
    this.setData({ backgroundUploads });
    this.persistBackgroundUploads();
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
        this.moveSubmittedUploadsToBackground();
        const newUploads = res.tempFiles.map((f, i) => ({
          id: Date.now() + '_' + i,
          path: f.tempFilePath,
          status: 'pending',
          subject: this.data.batchSubject,
        }));
        this.setData({
          uploads: newUploads,
          previewUrl: newUploads[0].path,
          previewUploadId: newUploads[0].id,
        });
      },
    });
  },
  selectPreview(e) {
    const id = e.currentTarget.dataset.id;
    const upload = this.data.uploads.find(item => item.id === id);
    if (!upload) return;
    this.setData({ previewUrl: upload.path, previewUploadId: upload.id });
  },
  toggleBackgroundUploads() {
    this.setData({ showBackgroundUploads: !this.data.showBackgroundUploads });
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
    return this.data.uploads.concat(this.data.backgroundUploads).some(item => (
      item.imageId && isActiveStatus(item.status)
    ));
  },
  refreshImageStatuses({ includeNeedsReview = false } = {}) {
    const imageIds = this.data.uploads.concat(this.data.backgroundUploads)
      .filter(item => item.imageId && (
        isActiveStatus(item.status)
        || (includeNeedsReview && item.status === 'needs_review')
      ))
      .map(item => item.imageId);
    const uniqueImageIds = [...new Set(imageIds)];
    if (!uniqueImageIds.length) return Promise.resolve([]);
    const statusBatches = [];
    for (let index = 0; index < uniqueImageIds.length; index += 9) {
      statusBatches.push(uniqueImageIds.slice(index, index + 9));
    }
    return Promise.all(statusBatches.map(api.getImageStatuses)).then(results => {
      const statuses = results.flat();
      const statusesById = new Map(statuses.map(item => [item.image_id, item]));
      const updateUploadStatuses = uploads => uploads.map(item => {
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
      const uploads = updateUploadStatuses(this.data.uploads);
      const backgroundUploads = updateUploadStatuses(this.data.backgroundUploads)
        .filter(shouldKeepBackgroundUpload);
      this.setData({ uploads, backgroundUploads });
      this.persistBackgroundUploads();
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
    return this.retryImage(image && image.imageId);
  },
  onBackgroundRetryTap(e) {
    return this.retryImage(e.currentTarget.dataset.imageId);
  },
  onRemoveBackgroundTap(e) {
    return this.confirmCancelImages([e.currentTarget.dataset.imageId]);
  },
  onClearAllBackgroundTasks() {
    return this.confirmCancelImages(
      this.data.backgroundUploads.map(item => item.imageId)
    );
  },
  confirmCancelImages(imageIds) {
    const uniqueImageIds = [...new Set(imageIds.filter(Boolean))];
    if (!uniqueImageIds.length) return Promise.resolve();
    const selectedUploads = this.data.backgroundUploads.filter(
      item => uniqueImageIds.includes(item.imageId)
    );
    const hasNeedsReview = selectedUploads.some(item => item.status === 'needs_review');
    const content = hasNeedsReview
      ? '待确认题将不收录；已自动收录的错题会保留。'
      : '这会取消所选图片任务，之后不再显示。';
    return new Promise(resolve => {
      wx.showModal({
        title: uniqueImageIds.length > 1 ? '批量移除任务' : '移除任务',
        content,
        confirmText: '确认移除',
        success: result => {
          if (!result.confirm) {
            resolve();
            return;
          }
          api.cancelImages(uniqueImageIds).then(response => {
            const cancelledIds = new Set(response.cancelled_image_ids || []);
            this.setData({
              uploads: this.data.uploads.filter(item => !cancelledIds.has(item.imageId)),
              backgroundUploads: this.data.backgroundUploads.filter(
                item => !cancelledIds.has(item.imageId)
              ),
            });
            this.persistBackgroundUploads();
            wx.showToast({ title: '任务已移除', icon: 'success' });
            resolve(response);
          }).catch(error => {
            wx.showToast({ title: error.message || '任务移除失败，请稍后重试', icon: 'none' });
            resolve();
          });
        },
      });
    });
  },
  showFailureReason(e) {
    const message = e.currentTarget.dataset.message || FAILURE_REASON_FALLBACK;
    wx.showModal({ title: '识别失败', content: message, showCancel: false });
  },
  retryImage(imageId) {
    const findFailed = item => item.imageId === imageId && item.status === 'failed';
    if (!imageId || !this.data.uploads.concat(this.data.backgroundUploads).some(findFailed)) {
      return Promise.resolve();
    }
    return api.retryImage(imageId).then(result => {
      const updateRetryStatus = uploads => uploads.map(item => item.imageId === imageId ? ({
        ...item,
        status: result.status,
        errorCode: null,
        errorMessage: null,
      }) : item);
      this.setData({
        uploads: updateRetryStatus(this.data.uploads),
        backgroundUploads: updateRetryStatus(this.data.backgroundUploads),
      });
      this.persistBackgroundUploads();
      return this.startStatusPolling();
    }).catch(error => {
      wx.showToast({ title: error.message || FAILURE_REASON_FALLBACK, icon: 'none' });
    });
  },
  onReviewTap(e) {
    const imageId = e.currentTarget.dataset.imageId;
    wx.navigateTo({
      url: `/pages/review-images/review-images${imageId ? `?imageId=${encodeURIComponent(imageId)}` : ''}`,
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
            this.persistBackgroundUploads();
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
