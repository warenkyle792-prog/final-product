/**
 * File uploads — event covers, avatars, promo videos and misc media.
 *
 * Accepts both direct file uploads (form-data) and, for images, an optional
 * base64 `data` field so camera captures can be posted as JSON.
 */
const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

const { UPLOADS_DIR: UPLOAD_ROOT } = require('../paths');
const KINDS = {
  cover: { dir: 'covers', maxBytes: 8 * 1024 * 1024 },
  avatar: { dir: 'avatars', maxBytes: 6 * 1024 * 1024 },
  video: { dir: 'videos', maxBytes: 80 * 1024 * 1024 },
  misc: { dir: 'misc', maxBytes: 8 * 1024 * 1024 },
};

for (const { dir } of Object.values(KINDS)) {
  const target = path.join(UPLOAD_ROOT, dir);
  if (!fs.existsSync(target)) fs.mkdirSync(target, { recursive: true });
}

function kindFrom(query) {
  return KINDS[query?.kind] ? query.kind : 'misc';
}

const storage = multer.diskStorage({
  destination: (req, _file, cb) => cb(null, path.join(UPLOAD_ROOT, KINDS[kindFrom(req.query)].dir)),
  filename: (_req, file, cb) => {
    const ext = (path.extname(file.originalname) || '.png').toLowerCase();
    cb(null, `${Date.now()}-${crypto.randomBytes(4).toString('hex')}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 80 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const kind = kindFrom(req.query);
    const okType = kind === 'video'
      ? /^video\//.test(file.mimetype)
      : /^image\/(png|jpe?g|webp|gif|avif)$/.test(file.mimetype);

    if (!okType) {
      return cb(Object.assign(
        new Error(kind === 'video' ? 'Only MP4, WebM or MOV videos are supported' : 'Only PNG, JPG, WEBP or GIF images are supported'),
        { status: 400 }
      ));
    }
    cb(null, true);
  },
});

const EXT_BY_MIME = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/webp': '.webp',
  'image/gif': '.gif',
  'image/avif': '.avif',
};

/** POST /api/uploads?kind=cover|avatar|video|misc */
router.post('/', requireAuth, (req, res, next) => {
  upload.single('file')(req, res, (error) => {
    if (error) {
      if (error.code === 'LIMIT_FILE_SIZE') {
        return res.status(413).json({ error: 'That file is too large. Images up to 8 MB, videos up to 80 MB.' });
      }
      return res.status(error.status || 400).json({ error: error.message });
    }
    next();
  });
}, (req, res) => {
  const kind = kindFrom(req.query);

  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

  // Guard against a file that slipped through with the wrong kind for its size.
  if (req.file.size > KINDS[kind].maxBytes) {
    fs.rmSync(req.file.path, { force: true });
    return res.status(413).json({ error: 'That file is too large for this upload slot' });
  }

  res.status(201).json({
    url: `/uploads/${KINDS[kind].dir}/${req.file.filename}`,
    kind,
    bytes: req.file.size,
  });
});

/**
 * POST /api/uploads/data — JSON variant used by the camera capture flow.
 * Body: { kind, data: "data:image/png;base64,…" }
 */
router.post('/data', requireAuth, express.json({ limit: '12mb' }), (req, res) => {
  const kind = kindFrom(req.query);
  if (kind === 'video') return res.status(400).json({ error: 'Send videos as multipart uploads' });

  const match = /^data:(image\/(?:png|jpeg|jpg|webp));base64,(.+)$/i.exec(String(req.body?.data || ''));
  if (!match) return res.status(400).json({ error: 'Expected a base64 image data URL' });

  const mime = match[1].toLowerCase().replace('image/jpg', 'image/jpeg');
  const buffer = Buffer.from(match[2], 'base64');

  if (buffer.byteLength > KINDS[kind].maxBytes) {
    return res.status(413).json({ error: 'That capture is too large — try a lower camera resolution' });
  }

  const dir = path.join(UPLOAD_ROOT, KINDS[kind].dir);
  const filename = `${Date.now()}-${crypto.randomBytes(4).toString('hex')}${EXT_BY_MIME[mime] || '.jpg'}`;
  fs.writeFileSync(path.join(dir, filename), buffer);

  res.status(201).json({ url: `/uploads/${KINDS[kind].dir}/${filename}`, kind, bytes: buffer.byteLength });
});

module.exports = router;
