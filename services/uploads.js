const path = require('path');
const multer = require('multer');
const sharp = require('sharp');

function createUploadService(config) {
  const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, config.uploadDir),
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname);
      cb(null, Date.now() + '-' + Math.random().toString(36).slice(2, 8) + ext);
    },
  });

  const upload = multer({
    storage,
    limits: { fileSize: 100 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
      const allowed = /jpeg|jpg|png|gif|webp/;
      if (allowed.test(path.extname(file.originalname).toLowerCase()) && allowed.test(file.mimetype)) {
        cb(null, true);
      } else {
        cb(new Error('只支持 jpg/png/gif/webp 格式'));
      }
    },
  });

  async function generateThumbnail(filePath) {
    try {
      const dir = path.dirname(filePath);
      const ext = path.extname(filePath);
      const base = path.basename(filePath, ext);
      const thumbPath = path.join(dir, 'thumb_' + base + '.webp');
      await sharp(filePath)
        .resize(800, null, { withoutEnlargement: true })
        .webp({ quality: 80 })
        .toFile(thumbPath);
      return '/uploads/thumb_' + base + '.webp';
    } catch (e) {
      console.error('缩略图生成失败:', e.message);
      return null;
    }
  }

  return { upload, generateThumbnail };
}

module.exports = { createUploadService };
