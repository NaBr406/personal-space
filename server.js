const express = require('express');
const path = require('path');
const multer = require('multer');
const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');

const app = express();
const PORT = process.env.PORT || 3000;

// ========== 配置 ==========
// 管理员密码，首次启动后会被哈希存入数据库，建议通过环境变量设置
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';

// ========== 数据库初始化 ==========
const db = new Database(path.join(__dirname, 'data.db'));
db.pragma('journal_mode = WAL'); // 提升并发性能

// 创建动态表
db.exec(`
  CREATE TABLE IF NOT EXISTS posts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    content TEXT NOT NULL,
    image TEXT,
    created_at DATETIME DEFAULT (datetime('now', 'localtime'))
  )
`);

// 创建配置表（存储哈希后的密码）
db.exec(`
  CREATE TABLE IF NOT EXISTS config (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  )
`);

// 初始化管理员密码（如果还没设置过）
const existingHash = db.prepare('SELECT value FROM config WHERE key = ?').get('admin_password_hash');
if (!existingHash) {
  const hash = bcrypt.hashSync(ADMIN_PASSWORD, 10);
  db.prepare('INSERT INTO config (key, value) VALUES (?, ?)').run('admin_password_hash', hash);
  console.log('✅ 管理员密码已初始化');
}

// ========== 中间件 ==========
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
// 静态文件服务
app.use(express.static(path.join(__dirname, 'public')));

// ========== 图片上传配置 ==========
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, path.join(__dirname, 'public/uploads'));
  },
  filename: (req, file, cb) => {
    // 用时间戳 + 随机数避免文件名冲突
    const ext = path.extname(file.originalname);
    const name = Date.now() + '-' + Math.random().toString(36).slice(2, 8) + ext;
    cb(null, name);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 最大 5MB
  fileFilter: (req, file, cb) => {
    const allowed = /jpeg|jpg|png|gif|webp/;
    const extOk = allowed.test(path.extname(file.originalname).toLowerCase());
    const mimeOk = allowed.test(file.mimetype);
    if (extOk && mimeOk) {
      cb(null, true);
    } else {
      cb(new Error('只支持 jpg/png/gif/webp 格式的图片'));
    }
  }
});

// ========== 密码校验中间件 ==========
function requireAdmin(req, res, next) {
  const password = req.headers['x-admin-password'] || req.body?.password;
  if (!password) {
    return res.status(401).json({ error: '需要管理员密码' });
  }
  const row = db.prepare('SELECT value FROM config WHERE key = ?').get('admin_password_hash');
  if (!row || !bcrypt.compareSync(password, row.value)) {
    return res.status(403).json({ error: '密码错误' });
  }
  next();
}

// ========== API 路由 ==========

// 获取动态列表（公开）
app.get('/api/posts', (req, res) => {
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const limit = Math.min(50, Math.max(1, parseInt(req.query.limit) || 10));
  const offset = (page - 1) * limit;

  const posts = db.prepare('SELECT * FROM posts ORDER BY created_at DESC LIMIT ? OFFSET ?').all(limit, offset);
  const total = db.prepare('SELECT COUNT(*) as count FROM posts').get().count;

  res.json({
    posts,
    pagination: { page, limit, total, pages: Math.ceil(total / limit) }
  });
});

// 发布动态（需要密码）
app.post('/api/posts', upload.single('image'), (req, res) => {
  // 手动校验密码（因为 multer 在 requireAdmin 之前解析 multipart）
  const password = req.headers['x-admin-password'] || req.body?.password;
  if (!password) {
    return res.status(401).json({ error: '需要管理员密码' });
  }
  const row = db.prepare('SELECT value FROM config WHERE key = ?').get('admin_password_hash');
  if (!row || !bcrypt.compareSync(password, row.value)) {
    return res.status(403).json({ error: '密码错误' });
  }

  const content = (req.body.content || '').trim();
  if (!content) {
    return res.status(400).json({ error: '内容不能为空' });
  }

  const image = req.file ? `/uploads/${req.file.filename}` : null;

  const result = db.prepare('INSERT INTO posts (content, image) VALUES (?, ?)').run(content, image);
  const post = db.prepare('SELECT * FROM posts WHERE id = ?').get(result.lastInsertRowid);

  res.status(201).json(post);
});

// 删除动态（需要密码）
app.delete('/api/posts/:id', requireAdmin, (req, res) => {
  const id = parseInt(req.params.id);
  const post = db.prepare('SELECT * FROM posts WHERE id = ?').get(id);
  if (!post) {
    return res.status(404).json({ error: '动态不存在' });
  }

  // 如果有图片，删除文件
  if (post.image) {
    const fs = require('fs');
    const imgPath = path.join(__dirname, 'public', post.image);
    fs.unlink(imgPath, () => {}); // 静默删除，失败不影响
  }

  db.prepare('DELETE FROM posts WHERE id = ?').run(id);
  res.json({ message: '已删除' });
});

// 验证密码（用于前端登录态）
app.post('/api/auth', (req, res) => {
  const password = req.body.password;
  if (!password) {
    return res.status(400).json({ error: '请输入密码' });
  }
  const row = db.prepare('SELECT value FROM config WHERE key = ?').get('admin_password_hash');
  if (row && bcrypt.compareSync(password, row.value)) {
    res.json({ ok: true });
  } else {
    res.status(403).json({ error: '密码错误' });
  }
});

// ========== 错误处理 ==========
app.use((err, req, res, next) => {
  // Multer 文件大小超限
  if (err.code === 'LIMIT_FILE_SIZE') {
    return res.status(400).json({ error: '图片大小不能超过 5MB' });
  }
  console.error('服务器错误:', err.message);
  res.status(500).json({ error: err.message || '服务器内部错误' });
});

// ========== 启动 ==========
app.listen(PORT, () => {
  console.log(`🚀 个人空间已启动: http://localhost:${PORT}`);
  console.log(`📁 数据库: ${path.join(__dirname, 'data.db')}`);
});
