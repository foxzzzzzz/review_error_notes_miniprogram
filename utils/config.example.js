module.exports = {
  SERVER_BASE: 'http://your-server-ip:8000',
  DEV_MODE: false,
  DEV_LOGIN_IDENTITY: 'dev-local-account',
  // Milliseconds between practice-sheet generation status requests.
  SHEET_GENERATION_POLL_INTERVAL_MS: 3000,
  // Maximum number of question crop images downloaded at once on the review page.
  REVIEW_CROP_CONCURRENCY: 2,
};
