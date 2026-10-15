const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const multer = require('multer');
const mimeByExtension = new Map([
  ['.jpg', 'image/jpeg'], ['.jpeg', 'image/jpeg'], ['.png', 'image/png'], ['.webp', 'image/webp'], ['.gif', 'image/gif'],
  ['.mp4', 'video/mp4'], ['.webm', 'video/webm'], ['.mov', 'video/quicktime']
]);
function hasValidSignature(file) {
  const buffer = file?.buffer;
  if (!buffer || buffer.length < 8) return false;
  const mime = file.mimetype;
  if (mime === 'image/jpeg') return buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  if (mime === 'image/png') return buffer.subarray(0,8).equals(Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]));
  if (mime === 'image/gif') return buffer.subarray(0,6).toString('ascii') === 'GIF87a' || buffer.subarray(0,6).toString('ascii') === 'GIF89a';
  if (mime === 'image/webp') return buffer.subarray(0,4).toString('ascii') === 'RIFF' && buffer.subarray(8,12).toString('ascii') === 'WEBP';
  if (mime === 'video/webm') return buffer.subarray(0,4).equals(Buffer.from([0x1a,0x45,0xdf,0xa3]));
  if (mime === 'video/mp4' || mime === 'video/quicktime') return buffer.length >= 12 && buffer.subarray(4,8).toString('ascii') === 'ftyp';
  return false;
}
function uploadMiddleware(config) {
  const storage = multer.memoryStorage();
  const upload = multer({
    storage,
    limits: { fileSize: 25 * 1024 * 1024, files: 1 },
    fileFilter: (_req, file, callback) => {
      const extension = path.extname(file.originalname || '').toLowerCase();
      if (!mimeByExtension.has(extension) || mimeByExtension.get(extension) !== file.mimetype) {
        return callback(Object.assign(new Error('Unsupported file'), { code: 'INVALID_UPLOAD' }));
      }
      callback(null, true);
    }
  });
  function save(req, res, next) {
    upload.single('file')(req, res, (error) => {
      if (error) return res.status(error.code === 'LIMIT_FILE_SIZE' ? 413 : 400).json({ error: error.code === 'LIMIT_FILE_SIZE' ? 'FILE_TOO_LARGE' : 'INVALID_UPLOAD' });
      if (!req.file) return res.status(400).json({ error: 'FILE_REQUIRED' });
      if (!hasValidSignature(req.file)) return res.status(400).json({ error: 'INVALID_UPLOAD' });
      try {
        fs.mkdirSync(config.uploadsDir, { recursive: true, mode: 0o700 });
        fs.chmodSync(config.uploadsDir, 0o700);
        const extension = path.extname(req.file.originalname).toLowerCase();
        const filename = `${crypto.randomUUID()}${extension}`;
        const filePath = path.join(config.uploadsDir, filename);
        fs.writeFileSync(filePath, req.file.buffer, { flag: 'wx', mode: 0o600 });
        fs.chmodSync(filePath, 0o600);
        res.status(201).json({ url: `/uploads/${filename}`, name: filename, mime: req.file.mimetype, size: req.file.size });
      } catch (writeError) { next(writeError); }
    });
  }
  return { save };
}
module.exports = { uploadMiddleware, mimeByExtension, hasValidSignature };
