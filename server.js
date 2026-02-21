const express = require("express");
const path = require("path");
const multer = require("multer");
const Database = require("better-sqlite3");
const bcrypt = require("bcryptjs");

const app = express();
const PORT = process.env.PORT || 3000;

// ========== 配置 ==========
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "admin123";

// ========== 数据库初始化 ==========
const db = new Database(path.join(__dirname, "data.db"));
db.pragma("journal_mode = WAL");

db.exec(`
  CREATE TABLE IF NOT EXISTS posts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    content TEXT,
    image TEXT,
    views INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT (datetime('now', 'localtime'))
  )
`);

// 迁移：给旧表加 views 字段
try {
  db.exec("ALTER TABLE posts ADD COLUMN views INTEGER DEFAULT 0");
} catch (e) {
  // 字段已存在，忽略
}

db.exec(`
  CREATE TABLE IF NOT EXISTS config (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  )
`);

const existingHash = db.prepare("SELECT value FROM config WHERE key = ?").get("admin_password_hash");
if (!existingHash) {
  const hash = bcrypt.hashSync(ADMIN_PASSWORD, 10);
  db.prepare("INSERT INTO config (key, value) VALUES (?, ?)").run("admin_password_hash", hash);
  console.log("✅ 管理员密码已初始化");
}

// ========== 中间件 ==========
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "public")));

// ========== 图片上传配置 ==========
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, path.join(__dirname, "public/uploads"));
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    const name = Date.now() + "-" + Math.random().toString(36).slice(2, 8) + ext;
    cb(null, name);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = /jpeg|jpg|png|gif|webp/;
    const extOk = allowed.test(path.extname(file.originalname).toLowerCase());
    const mimeOk = allowed.test(file.mimetype);
    if (extOk && mimeOk) {
      cb(null, true);
    } else {
      cb(new Error("只支持 jpg/png/gif/webp 格式的图片"));
    }
  }
});

// ========== 密码校验中间件 ==========
function requireAdmin(req, res, next) {
  const password = req.headers["x-admin-password"] || req.body?.password;
  if (!password) {
    return res.status(401).json({ error: "需要管理员密码" });
  }
  const row = db.prepare("SELECT value FROM config WHERE key = ?").get("admin_password_hash");
  if (!row || !bcrypt.compareSync(password, row.value)) {
    return res.status(403).json({ error: "密码错误" });
  }
  next();
}

// ========== API 路由 ==========

// 获取动态列表（支持日期过滤）
app.get("/api/posts", (req, res) => {
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const limit = Math.min(50, Math.max(1, parseInt(req.query.limit) || 10));
  const offset = (page - 1) * limit;
  const startDate = req.query.start || null;
  const endDate = req.query.end || null;

  let where = "";
  const params = [];

  if (startDate && endDate) {
    where = "WHERE created_at >= ? AND created_at < datetime(?, +1 day)";
    params.push(startDate, endDate);
  } else if (startDate) {
    where = "WHERE created_at >= ?";
    params.push(startDate);
  } else if (endDate) {
    where = "WHERE created_at < datetime(?, +1 day)";
    params.push(endDate);
  }

  const posts = db.prepare(`SELECT * FROM posts ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`).all(...params, limit, offset);
  const total = db.prepare(`SELECT COUNT(*) as count FROM posts ${where}`).all(...params)[0].count;

  res.json({
    posts,
    pagination: { page, limit, total, pages: Math.ceil(total / limit) }
  });
});

// 记录浏览次数
app.post("/api/posts/:id/view", (req, res) => {
  const id = parseInt(req.params.id);
  const post = db.prepare("SELECT id FROM posts WHERE id = ?").get(id);
  if (!post) {
    return res.status(404).json({ error: "动态不存在" });
  }
  db.prepare("UPDATE posts SET views = views + 1 WHERE id = ?").run(id);
  const updated = db.prepare("SELECT views FROM posts WHERE id = ?").get(id);
  res.json({ views: updated.views });
});

// 发布动态（内容和图片至少有一个）
app.post("/api/posts", upload.single("image"), (req, res) => {
  const password = req.headers["x-admin-password"] || req.body?.password;
  if (!password) {
    return res.status(401).json({ error: "需要管理员密码" });
  }
  const row = db.prepare("SELECT value FROM config WHERE key = ?").get("admin_password_hash");
  if (!row || !bcrypt.compareSync(password, row.value)) {
    return res.status(403).json({ error: "密码错误" });
  }

  const content = (req.body.content || "").trim() || null;
  const image = req.file ? `/uploads/${req.file.filename}` : null;

  if (!content && !image) {
    return res.status(400).json({ error: "内容和图片至少需要一个" });
  }

  const result = db.prepare("INSERT INTO posts (content, image, created_at) VALUES (?, ?, datetime('now', 'localtime'  ))").run(content, image);
  const post = db.prepare("SELECT * FROM posts WHERE id = ?").get(result.lastInsertRowid);

  res.status(201).json(post);
});

// 删除动态
app.delete("/api/posts/:id", requireAdmin, (req, res) => {
  const id = parseInt(req.params.id);
  const post = db.prepare("SELECT * FROM posts WHERE id = ?").get(id);
  if (!post) {
    return res.status(404).json({ error: "动态不存在" });
  }

  if (post.image) {
    const fs = require("fs");
    const imgPath = path.join(__dirname, "public", post.image);
    fs.unlink(imgPath, () => {});
  }

  db.prepare("DELETE FROM posts WHERE id = ?").run(id);
  res.json({ message: "已删除" });
});

// 修改密码
app.post("/api/change-password", (req, res) => {
  const { oldPassword, newPassword } = req.body;
  if (!oldPassword || !newPassword) {
    return res.status(400).json({ error: "请输入旧密码和新密码" });
  }
  if (newPassword.length < 4) {
    return res.status(400).json({ error: "新密码至少4位" });
  }
  const row = db.prepare("SELECT value FROM config WHERE key = ?").get("admin_password_hash");
  if (!row || !bcrypt.compareSync(oldPassword, row.value)) {
    return res.status(403).json({ error: "旧密码错误" });
  }
  const hash = bcrypt.hashSync(newPassword, 10);
  db.prepare("UPDATE config SET value = ? WHERE key = ?").run(hash, "admin_password_hash");
  res.json({ ok: true, message: "密码修改成功" });
});

// 验证密码
app.post("/api/auth", (req, res) => {
  const password = req.body.password;
  if (!password) {
    return res.status(400).json({ error: "请输入密码" });
  }
  const row = db.prepare("SELECT value FROM config WHERE key = ?").get("admin_password_hash");
  if (row && bcrypt.compareSync(password, row.value)) {
    res.json({ ok: true });
  } else {
    res.status(403).json({ error: "密码错误" });
  }
});

// ========== 错误处理 ==========
app.use((err, req, res, next) => {
  if (err.code === "LIMIT_FILE_SIZE") {
    return res.status(400).json({ error: "图片大小不能超过 5MB" });
  }
  console.error("服务器错误:", err.message);
  res.status(500).json({ error: err.message || "服务器内部错误" });
});

// ========== 启动 ==========
app.listen(PORT, () => {
  console.log(`🚀 个人空间已启动: http://localhost:${PORT}`);
  console.log(`📁 数据库: ${path.join(__dirname, "data.db")}`);
});
