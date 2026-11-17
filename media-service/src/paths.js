const path = require('path').posix;

const UPLOAD_ROOT = process.env.UPLOAD_ROOT || '/data/uploads';

const originalPath = (id, ext) => path.join(UPLOAD_ROOT, 'originals', `${id}.${ext}`);
const gridPath = (id) => path.join(UPLOAD_ROOT, 'grid', `${id}.jpg`);
const posterPath = (id) => path.join(UPLOAD_ROOT, 'posters', `${id}.jpg`);
const videoPath = (id) => path.join(UPLOAD_ROOT, 'video', `${id}.mp4`);
const manifestPath = () => path.join(UPLOAD_ROOT, 'manifest.jsonl');

module.exports = { UPLOAD_ROOT, originalPath, gridPath, posterPath, videoPath, manifestPath };
