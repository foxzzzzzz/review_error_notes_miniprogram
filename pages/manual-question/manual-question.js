const api = require('../../utils/api');
const { normalizedPointFromRect, bboxFromPoints, buildManualQuestionPayload, QUESTION_TYPES, questionTypeIndex } = require('../../utils/review-correction');

const makeQuestionId = () => 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, char => {
  const random = Math.floor(Math.random() * 16);
  return (char === 'x' ? random : ((random & 0x3) | 0x8)).toString(16);
});

Page({
  data: {
    imageId: '', imagePath: '', imageWidth: 0, imageHeight: 0,
    displayWidth: 0, displayHeight: 0, baseDisplayWidth: 0, zoom: 1, stageStyle: '',
    firstPoint: null, secondPoint: null, bbox: null, selectionStyle: '',
    pointMode: 'first', step: 'select', cropPreviewPath: '',
    instruction: '', prompt_text: '', question_type: '', correct_answer: '', student_answer: '',
    questionTypes: QUESTION_TYPES, questionTypeIndex: questionTypeIndex('other'),
    saving: false,
    manualQuestionId: '',
  },
  onLoad(options) {
    const imageId = options.imageId || '';
    const info = wx.getSystemInfoSync();
    this.setData({ imageId, manualQuestionId: makeQuestionId(), displayWidth: info.windowWidth });
    if (!imageId) {
      wx.showToast({ title: '缺少图片信息', icon: 'none' });
      return;
    }
    return api.downloadNormalizedOriginalImage(imageId).then(imagePath => {
      this.setData({ imagePath });
    }).catch(() => wx.showToast({ title: '原图加载失败，请返回重试', icon: 'none' }));
  },
  onImageLoad(e) {
    const { width, height } = e.detail;
    this.setData({ imageWidth: width, imageHeight: height });
    wx.createSelectorQuery().in(this).select('.image-stage').boundingClientRect(rect => {
      if (!rect || !rect.width) return;
      const baseDisplayWidth = this.data.baseDisplayWidth || rect.width / this.data.zoom;
      this.setData({
        baseDisplayWidth,
        displayWidth: baseDisplayWidth * this.data.zoom,
        displayHeight: baseDisplayWidth * this.data.zoom * height / width,
        stageStyle: this.stageStyle(baseDisplayWidth * this.data.zoom, height / width),
      });
    }).exec();
  },
  stageStyle(displayWidth, imageRatio) {
    return `width:${displayWidth}px;height:${displayWidth * imageRatio}px;`;
  },
  setZoom(e) {
    const zoom = Number(e.currentTarget.dataset.zoom);
    if (!this.data.baseDisplayWidth || ![1, 2].includes(zoom)) return;
    const displayWidth = this.data.baseDisplayWidth * zoom;
    this.setData({
      zoom,
      displayWidth,
      displayHeight: displayWidth * this.data.imageHeight / this.data.imageWidth,
      stageStyle: this.stageStyle(displayWidth, this.data.imageHeight / this.data.imageWidth),
    });
  },
  onStageTap(e) {
    const touch = (e.changedTouches && e.changedTouches[0]) || (e.touches && e.touches[0]);
    if (!touch || touch.clientX == null || touch.clientY == null) return;
    wx.createSelectorQuery().in(this).select('.image-stage').boundingClientRect(rect => {
      const point = normalizedPointFromRect(touch.clientX, touch.clientY, rect);
      if (!point) return;
      if (this.data.pointMode === 'first' || !this.data.firstPoint || (this.data.firstPoint && this.data.secondPoint && this.data.pointMode === 'new')) {
        this.setData({ firstPoint: point, secondPoint: null, bbox: null, selectionStyle: '', pointMode: 'second', cropPreviewPath: '' });
        return;
      }
      const bbox = bboxFromPoints(this.data.firstPoint, point);
      this.setData({ secondPoint: point, bbox, selectionStyle: this.styleForBbox(bbox), pointMode: 'new' }, () => this.drawCropPreview());
    }).exec();
  },
  choosePoint(e) {
    this.setData({ pointMode: e.currentTarget.dataset.point });
    wx.showToast({ title: e.currentTarget.dataset.point === 'first' ? '点击原图设置框的起点' : '点击原图设置框的终点', icon: 'none' });
  },
  nudge(e) {
    const bbox = this.data.bbox;
    if (!bbox) return;
    const edge = e.currentTarget.dataset.edge;
    const delta = Number(e.currentTarget.dataset.delta) * 0.01;
    const next = bbox.slice();
    const index = { left: 0, top: 1, right: 2, bottom: 3 }[edge];
    next[index] = Math.max(0, Math.min(1, next[index] + delta));
    if (next[2] - next[0] < 0.01 || next[3] - next[1] < 0.01) return;
    this.setData({ bbox: next, selectionStyle: this.styleForBbox(next) }, () => this.drawCropPreview());
  },
  styleForBbox(bbox) {
    if (!bbox) return '';
    return `left:${bbox[0] * 100}%;top:${bbox[1] * 100}%;width:${(bbox[2] - bbox[0]) * 100}%;height:${(bbox[3] - bbox[1]) * 100}%;`;
  },
  drawCropPreview() {
    const bbox = this.data.bbox;
    if (!bbox || !this.data.imagePath) return;
    wx.getImageInfo({
      src: this.data.imagePath,
      success: info => {
        const sourceX = bbox[0] * info.width;
        const sourceY = bbox[1] * info.height;
        const sourceWidth = (bbox[2] - bbox[0]) * info.width;
        const sourceHeight = (bbox[3] - bbox[1]) * info.height;
        const scale = Math.min(600 / sourceWidth, 360 / sourceHeight);
        const width = Math.max(1, Math.round(sourceWidth * scale));
        const height = Math.max(1, Math.round(sourceHeight * scale));
        const context = wx.createCanvasContext('crop-preview', this);
        context.clearRect(0, 0, 600, 360);
        context.drawImage(this.data.imagePath, sourceX, sourceY, sourceWidth, sourceHeight, 0, 0, width, height);
        context.draw(false, () => wx.canvasToTempFilePath({
          canvasId: 'crop-preview', x: 0, y: 0, width, height,
          destWidth: width, destHeight: height,
          success: result => this.setData({ cropPreviewPath: result.tempFilePath }),
        }, this));
      },
    });
  },
  onContinue() {
    if (!this.data.bbox) {
      wx.showToast({ title: '先在原图上框出题目区域', icon: 'none' });
      return;
    }
    this.setData({ selectionStyle: this.styleForBbox(this.data.bbox), step: 'fields' });
  },
  onFieldInput(e) {
    const field = e.currentTarget.dataset.field;
    if (['instruction', 'prompt_text', 'question_type', 'correct_answer', 'student_answer'].includes(field)) {
      this.setData({ [field]: e.detail.value });
    }
  },
  onQuestionTypeChange(e) {
    const index = Number(e.detail.value);
    const selected = this.data.questionTypes[index];
    if (selected) this.setData({ question_type: selected.value, questionTypeIndex: index });
  },
  backToSelection() { this.setData({ step: 'select' }); },
  onSave() {
    const required = ['instruction', 'prompt_text', 'question_type', 'correct_answer'];
    if (required.some(field => !String(this.data[field] || '').trim())) {
      wx.showToast({ title: '请填写题目要求、内容、题型和正确答案', icon: 'none' });
      return;
    }
    if (this.data.saving) return;
    this.setData({ saving: true });
    const fields = {
      instruction: this.data.instruction,
      prompt_text: this.data.prompt_text,
      question_type: this.data.question_type,
      correct_answer: this.data.correct_answer,
      student_answer: this.data.student_answer,
    };
    return api.addManualReviewQuestions(this.data.imageId,
      buildManualQuestionPayload(this.data.manualQuestionId, this.data.bbox, fields)
    ).then(() => {
      const pages = getCurrentPages();
      const previousPage = pages[pages.length - 2];
      if (previousPage && previousPage.setData) previousPage.setData({ refreshAfterManual: true });
      wx.showToast({ title: '已补充错题', icon: 'success' });
      setTimeout(() => wx.navigateBack(), 350);
    }).catch(error => {
      wx.showToast({ title: error.message || '保存失败，内容已保留，请重试', icon: 'none' });
    }).finally(() => this.setData({ saving: false }));
  },
});
