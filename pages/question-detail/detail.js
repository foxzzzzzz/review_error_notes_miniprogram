const api = require('../../utils/api');

const imageErrorMessage = (error) => {
  if (error && error.statusCode === 404) return '原图文件不存在，请重新录入';
  if (error && error.statusCode === 422) return '图片文件损坏，无法显示';
  return '图片加载失败，请重试';
};

Page({
  data: {
    question: {},
    reviewInfo: null,
    subjects: ['数学','语文','英语'],
    subjectIndex: 0,
    cropImagePath: '',
    originalImagePath: '',
    imageLoading: false,
    imageError: '',
    difficultyLabel: '很简单',
    difficultyOptions: [
      { value: 1, label: '很简单' },
      { value: 2, label: '简单' },
      { value: 3, label: '中等' },
      { value: 4, label: '困难' },
      { value: 5, label: '很困难' },
    ],
  },
  onLoad(options) {
    return api.getQuestion(options.id).then(q => {
      const subjectIndex = ['math','chinese','english'].indexOf(q.subject);
      const difficulty = Number.isInteger(q.difficulty) && q.difficulty >= 1 && q.difficulty <= 5
        ? q.difficulty
        : 1;
      const raw = q.ocr_raw_json || {};
      const confidenceText = typeof raw.confidence === 'number'
        ? `${Math.round(raw.confidence * 100)}%`
        : '未提供';
      this.setData({
        question: { ...q, difficulty },
        reviewInfo: {
          normalizedText: raw.normalized_text || '',
          answer: q.ocr_answer || raw.answer || '',
          confidenceText,
          uncertainSegments: raw.uncertain_segments || [],
        },
        subjectIndex: subjectIndex < 0 ? 0 : subjectIndex,
        difficultyLabel: this.data.difficultyOptions[difficulty - 1].label,
      });
      return this.loadCropImage();
    }).catch(() => wx.showToast({ title: '加载失败', icon: 'none' }));
  },
  loadCropImage() {
    const questionId = this.data.question.id;
    if (!questionId) return Promise.resolve();
    this.setData({ cropImagePath: '', imageLoading: true, imageError: '' });
    return api.downloadQuestionImage(questionId, 'crop').then(path => {
      this.setData({ cropImagePath: path, imageLoading: false, imageError: '' });
    }).catch(error => {
      this.setData({
        cropImagePath: '',
        imageLoading: false,
        imageError: error && error.statusCode === 401 ? '' : imageErrorMessage(error),
      });
    });
  },
  onImageError() {
    this.setData({
      cropImagePath: '',
      imageLoading: false,
      imageError: '图片加载失败，请重试',
    });
  },
  previewOriginal() {
    if (this.data.originalImagePath) {
      this.showOriginalPreview(this.data.originalImagePath);
      return Promise.resolve();
    }
    if (this.data.imageLoading) return Promise.resolve();
    this.setData({ imageLoading: true });
    return api.downloadQuestionImage(this.data.question.id, 'original').then(path => {
      this.setData({ originalImagePath: path, imageLoading: false });
      this.showOriginalPreview(path);
    }).catch(error => {
      this.setData({ imageLoading: false });
      if (error && error.statusCode === 401) return;
      wx.showToast({ title: imageErrorMessage(error), icon: 'none' });
    });
  },
  showOriginalPreview(path) {
    wx.previewImage({
      current: path,
      urls: [path],
      fail: () => wx.showToast({ title: '原图预览失败', icon: 'none' }),
    });
  },
  save() {
    api.updateQuestion(this.data.question.id, this.data.question)
      .then(() => wx.navigateBack())
      .catch(() => wx.showToast({ title: '保存失败', icon: 'none' }));
  },
  remove() {
    wx.showModal({ title: '确认删除', success: (r) => {
      if (r.confirm) {
        api.deleteQuestion(this.data.question.id)
          .then(() => wx.navigateBack())
          .catch(error => wx.showToast({
            title: (error && error.message) || '删除失败',
            icon: 'none',
          }));
      }
    }});
  },
  onTextInput(e) { this.setData({ 'question.ocr_text': e.detail.value }); },
  addTag(e) { this.setData({ 'question.tags': [...(this.data.question.tags || []), e.detail.value] }); },
  onSubjectChange(e) {
    const idx = parseInt(e.detail.value);
    this.setData({ subjectIndex: idx, 'question.subject': ['math','chinese','english'][idx] });
  },
  onDifficultyTap(e) {
    const difficulty = Number(e.currentTarget.dataset.value);
    if (!Number.isInteger(difficulty) || difficulty < 1 || difficulty > 5) return;
    this.setData({
      'question.difficulty': difficulty,
      difficultyLabel: this.data.difficultyOptions[difficulty - 1].label,
    });
  },
});
