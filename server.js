const express = require("express");
const path = require("path");
const multer = require("multer");
const sharp = require("sharp");
const fs = require("fs");
const Database = require("better-sqlite3");
const bcrypt = require("bcryptjs");
const crypto = require("crypto");

const app = express();
const PORT = process.env.PORT || 3000;

// ========== 数据库初始化 ==========
const db = new Database(path.join(__dirname, "data.db"));
db.pragma("journal_mode = WAL");

// 用户表
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    nickname TEXT NOT NULL,
    avatar TEXT DEFAULT '/default-avatar.png',
    role TEXT DEFAULT 'guest',
    token TEXT,
    created_at DATETIME DEFAULT (datetime('now', 'localtime'))
  )
`);

// 动态表（加 user_id）
db.exec(`
  CREATE TABLE IF NOT EXISTS posts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    content TEXT,
    image TEXT,
    user_id INTEGER,
    views INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT (datetime('now', 'localtime')),
    FOREIGN KEY (user_id) REFERENCES users(id)
  )
`);

// 点赞表
db.exec(`
  CREATE TABLE IF NOT EXISTS likes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    post_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    created_at DATETIME DEFAULT (datetime('now', 'localtime')),
    UNIQUE(post_id, user_id),
    FOREIGN KEY (post_id) REFERENCES posts(id),
    FOREIGN KEY (user_id) REFERENCES users(id)
  )
`);

// 迁移：给旧 posts 表加 user_id
try { db.exec("ALTER TABLE posts ADD COLUMN user_id INTEGER"); } catch(e) {}
try { db.exec("ALTER TABLE posts ADD COLUMN thumbnail TEXT"); } catch(e) {}
try { db.exec("ALTER TABLE users ADD COLUMN register_ip TEXT"); } catch(e) {}

// 初始化超级管理员
const superAdmin = db.prepare("SELECT id FROM users WHERE role = 'superadmin'").get();
if (!superAdmin) {
  const hash = bcrypt.hashSync("admin123", 10);
  db.prepare("INSERT INTO users (username, password_hash, nickname, role) VALUES (?, ?, ?, ?)").run("NaBr406", hash, "NaBr406", "superadmin");
  console.log("✅ 超级管理员已创建 (admin / admin123)");
}

// ========== 中间件 ==========
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "public")));

// ========== 图片上传 ==========
const uploadDir = path.join(__dirname, "public/uploads");
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, Date.now() + "-" + Math.random().toString(36).slice(2, 8) + ext);
  }
});
const upload = multer({
  storage,
  limits: { fileSize: 100 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = /jpeg|jpg|png|gif|webp/;
    if (allowed.test(path.extname(file.originalname).toLowerCase()) && allowed.test(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error("只支持 jpg/png/gif/webp 格式"));
    }
  }
});

// ========== 缩略图生成 ==========
async function generateThumbnail(filePath) {
  try {
    const dir = path.dirname(filePath);
    const ext = path.extname(filePath);
    const base = path.basename(filePath, ext);
    const thumbPath = path.join(dir, "thumb_" + base + ".webp");
    await sharp(filePath)
      .resize(800, null, { withoutEnlargement: true })
      .webp({ quality: 80 })
      .toFile(thumbPath);
    return "/uploads/thumb_" + base + ".webp";
  } catch (e) {
    console.error("缩略图生成失败:", e.message);
    return null;
  }
}

// ========== Token 认证中间件 ==========
function getUser(req) {
  const token = req.headers["authorization"]?.replace("Bearer ", "");
  if (!token) return null;
  return db.prepare("SELECT id, username, nickname, avatar, role FROM users WHERE token = ?").get(token) || null;
}

function requireLogin(req, res, next) {
  const user = getUser(req);
  if (!user) return res.status(401).json({ error: "请先登录" });
  req.user = user;
  next();
}

function requireAdmin(req, res, next) {
  const user = getUser(req);
  if (!user) return res.status(401).json({ error: "请先登录" });
  if (user.role !== "admin" && user.role !== "superadmin") {
    return res.status(403).json({ error: "需要管理员权限" });
  }
  req.user = user;
  next();
}

function requireSuperAdmin(req, res, next) {
  const user = getUser(req);
  if (!user) return res.status(401).json({ error: "请先登录" });
  if (user.role !== "superadmin") {
    return res.status(403).json({ error: "需要超级管理员权限" });
  }
  req.user = user;
  next();
}

// ========== 认证 API ==========

// ========== 验证码 ==========
const captchaStore = new Map(); // token -> { answer, expires }

app.get("/api/captcha", (req, res) => {
  const a = Math.floor(Math.random() * 20) + 1;
  const b = Math.floor(Math.random() * 20) + 1;
  const ops = [
    { symbol: "+", answer: a + b },
    { symbol: "-", answer: Math.max(a, b) - Math.min(a, b) },
  ];
  const op = ops[Math.floor(Math.random() * ops.length)];
  const x = op.symbol === "-" ? Math.max(a, b) : a;
  const y = op.symbol === "-" ? Math.min(a, b) : b;
  const question = `${x} ${op.symbol} ${y} = ?`;
  const token = crypto.randomBytes(16).toString("hex");
  captchaStore.set(token, { answer: op.answer, expires: Date.now() + 5 * 60 * 1000 });
  // 清理过期
  for (const [k, v] of captchaStore) {
    if (v.expires < Date.now()) captchaStore.delete(k);
  }
  res.json({ question, token });
});

// 注册
app.post("/api/register", (req, res) => {
  const { captchaToken, captchaAnswer } = req.body;
  if (!captchaToken || captchaAnswer === undefined) return res.status(400).json({ error: "请完成验证码" });
  const cap = captchaStore.get(captchaToken);
  if (!cap) return res.status(400).json({ error: "验证码已过期，请刷新" });
  if (cap.expires < Date.now()) { captchaStore.delete(captchaToken); return res.status(400).json({ error: "验证码已过期，请刷新" }); }
  if (parseInt(captchaAnswer) !== cap.answer) return res.status(400).json({ error: "验证码错误" });
  captchaStore.delete(captchaToken);
  const { username, password, nickname } = req.body;
  if (!username || !password) return res.status(400).json({ error: "用户名和密码必填" });
  if (username.length < 2 || username.length > 20) return res.status(400).json({ error: "用户名 2-20 字符" });
  if (password.length < 4) return res.status(400).json({ error: "密码至少 4 位" });

  // IP 限制：每个 IP 只能注册一次
  const clientIp = req.headers["x-forwarded-for"]?.split(",")[0]?.trim() || req.ip;
  const ipExists = db.prepare("SELECT id FROM users WHERE register_ip = ?").get(clientIp);
  if (ipExists) return res.status(403).json({ error: "该网络已注册过账号" });

  const existing = db.prepare("SELECT id FROM users WHERE username = ?").get(username);
  if (existing) return res.status(409).json({ error: "用户名已存在" });

  const hash = bcrypt.hashSync(password, 10);
  const token = crypto.randomBytes(32).toString("hex");
  const displayName = (nickname || "").trim() || username;

  const result = db.prepare("INSERT INTO users (username, password_hash, nickname, token, register_ip) VALUES (?, ?, ?, ?, ?)").run(username, hash, displayName, token, clientIp);
  const user = db.prepare("SELECT id, username, nickname, avatar, role FROM users WHERE id = ?").get(result.lastInsertRowid);

  res.status(201).json({ ...user, token });
});

// 登录
app.post("/api/login", (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: "用户名和密码必填" });

  const user = db.prepare("SELECT * FROM users WHERE username = ?").get(username);
  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    return res.status(403).json({ error: "用户名或密码错误" });
  }

  const token = crypto.randomBytes(32).toString("hex");
  db.prepare("UPDATE users SET token = ? WHERE id = ?").run(token, user.id);

  res.json({ id: user.id, username: user.username, nickname: user.nickname, avatar: user.avatar, role: user.role, token });
});

// 获取当前用户信息
app.get("/api/me", requireLogin, (req, res) => {
  res.json(req.user);
});

// 修改个人信息（昵称、头像）
app.put("/api/me", requireLogin, upload.single("avatar"), (req, res) => {
  const nickname = (req.body.nickname || "").trim();
  const avatar = req.file ? `/uploads/${req.file.filename}` : null;

  if (nickname) db.prepare("UPDATE users SET nickname = ? WHERE id = ?").run(nickname, req.user.id);
  if (avatar) db.prepare("UPDATE users SET avatar = ? WHERE id = ?").run(avatar, req.user.id);

  const updated = db.prepare("SELECT id, username, nickname, avatar, role FROM users WHERE id = ?").get(req.user.id);
  res.json(updated);
});

// 直接修改密码（已登录）
app.post("/api/change-password-direct", requireLogin, (req, res) => {
  const { newPassword } = req.body;
  if (!newPassword || newPassword.length < 4) return res.status(400).json({ error: "密码至少 4 位" });
  const hash = bcrypt.hashSync(newPassword, 10);
  db.prepare("UPDATE users SET password_hash = ? WHERE id = ?").run(hash, req.user.id);
  res.json({ ok: true });
});

// 修改密码
app.post("/api/change-password", requireLogin, (req, res) => {
  const { oldPassword, newPassword } = req.body;
  if (!oldPassword || !newPassword) return res.status(400).json({ error: "请输入旧密码和新密码" });
  if (newPassword.length < 4) return res.status(400).json({ error: "新密码至少 4 位" });

  const user = db.prepare("SELECT password_hash FROM users WHERE id = ?").get(req.user.id);
  if (!bcrypt.compareSync(oldPassword, user.password_hash)) {
    return res.status(403).json({ error: "旧密码错误" });
  }

  const hash = bcrypt.hashSync(newPassword, 10);
  db.prepare("UPDATE users SET password_hash = ? WHERE id = ?").run(hash, req.user.id);
  res.json({ ok: true });
});

// ========== 用户管理 API（超管） ==========

// 获取用户列表
app.get("/api/users", requireSuperAdmin, (req, res) => {
  const users = db.prepare("SELECT id, username, nickname, avatar, role, created_at FROM users ORDER BY created_at DESC").all();
  res.json(users);
});

// 修改用户角色
app.put("/api/users/:id/role", requireSuperAdmin, (req, res) => {
  const id = parseInt(req.params.id);
  const { role } = req.body;
  if (!["guest", "admin"].includes(role)) return res.status(400).json({ error: "角色只能是 guest 或 admin" });

  const target = db.prepare("SELECT id, role FROM users WHERE id = ?").get(id);
  if (!target) return res.status(404).json({ error: "用户不存在" });
  if (target.role === "superadmin") return res.status(403).json({ error: "不能修改超级管理员" });

  db.prepare("UPDATE users SET role = ? WHERE id = ?").run(role, id);
  res.json({ ok: true });
});

// ========== 删除用户 API ==========
app.delete("/api/users/:id", requireSuperAdmin, (req, res) => {
  const id = parseInt(req.params.id);
  const target = db.prepare("SELECT * FROM users WHERE id = ?").get(id);
  if (!target) return res.status(404).json({ error: "用户不存在" });
  if (target.role === "superadmin") return res.status(403).json({ error: "不能删除超级管理员" });

  // 删除用户的点赞记录
  db.prepare("DELETE FROM likes WHERE user_id = ?").run(id);
  // 删除用户的动态及图片
  const posts = db.prepare("SELECT * FROM posts WHERE user_id = ?").all(id);
  for (const post of posts) {
    if (post.image) fs.unlink(path.join(__dirname, "public", post.image), () => {});
    if (post.thumbnail) fs.unlink(path.join(__dirname, "public", post.thumbnail), () => {});
    db.prepare("DELETE FROM likes WHERE post_id = ?").run(post.id);
  }
  db.prepare("DELETE FROM posts WHERE user_id = ?").run(id);
  // 删除用户
  db.prepare("DELETE FROM users WHERE id = ?").run(id);

  res.json({ message: "用户已删除" });
});

// ========== 动态 API ==========

// 获取动态列表
app.get("/api/posts", (req, res) => {
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const limit = Math.min(50, Math.max(1, parseInt(req.query.limit) || 10));
  const offset = (page - 1) * limit;
  const startDate = req.query.start || null;
  const endDate = req.query.end || null;

  let where = "";
  const params = [];
  if (startDate && endDate) {
    where = "WHERE p.created_at >= ? AND p.created_at < datetime(?, '+1 day')";
    params.push(startDate, endDate);
  } else if (startDate) {
    where = "WHERE p.created_at >= ?";
    params.push(startDate);
  } else if (endDate) {
    where = "WHERE p.created_at < datetime(?, '+1 day')";
    params.push(endDate);
  }

  const posts = db.prepare(`
    SELECT p.*, u.nickname as author_name, u.avatar as author_avatar,
    (SELECT COUNT(*) FROM likes WHERE post_id = p.id) as like_count
    FROM posts p LEFT JOIN users u ON p.user_id = u.id
    ${where} ORDER BY p.created_at DESC LIMIT ? OFFSET ?
  `).all(...params, limit, offset);

  const total = db.prepare(`SELECT COUNT(*) as count FROM posts p ${where}`).all(...params)[0].count;

  // 如果用户已登录，标记是否已点赞
  const user = getUser(req);
  if (user) {
    posts.forEach(post => {
      post.liked = !!db.prepare("SELECT 1 FROM likes WHERE post_id = ? AND user_id = ?").get(post.id, user.id);
    });
  }

  res.json({ posts, pagination: { page, limit, total, pages: Math.ceil(total / limit) } });
});

// 获取单条动态
app.get("/api/posts/:id", (req, res) => {
  const id = parseInt(req.params.id);
  const post = db.prepare(`
    SELECT p.*, u.nickname as author_name, u.avatar as author_avatar,
    (SELECT COUNT(*) FROM likes WHERE post_id = p.id) as like_count
    FROM posts p LEFT JOIN users u ON p.user_id = u.id WHERE p.id = ?
  `).get(id);
  if (!post) return res.status(404).json({ error: "动态不存在" });

  const user = getUser(req);
  if (user) {
    post.liked = !!db.prepare("SELECT 1 FROM likes WHERE post_id = ? AND user_id = ?").get(post.id, user.id);
  }
  res.json(post);
});

// 浏览计数
app.post("/api/posts/:id/view", (req, res) => {
  const id = parseInt(req.params.id);
  db.prepare("UPDATE posts SET views = views + 1 WHERE id = ?").run(id);
  const post = db.prepare("SELECT views FROM posts WHERE id = ?").get(id);
  res.json({ views: post ? post.views : 0 });
});

// 发布动态（管理员+超管）
app.post("/api/posts", requireAdmin, upload.single("image"), async (req, res) => {
  try {
    const content = (req.body.content || "").trim() || null;
    const image = req.file ? `/uploads/${req.file.filename}` : null;
    if (!content && !image) return res.status(400).json({ error: "内容和图片至少需要一个" });

    let thumbnail = null;
    if (req.file) {
      thumbnail = await generateThumbnail(req.file.path);
    }

    const result = db.prepare("INSERT INTO posts (content, image, thumbnail, user_id, created_at) VALUES (?, ?, ?, ?, datetime('now', 'localtime'))").run(content, image, thumbnail, req.user.id);
    const post = db.prepare(`
      SELECT p.*, u.nickname as author_name, u.avatar as author_avatar, 0 as like_count
      FROM posts p LEFT JOIN users u ON p.user_id = u.id WHERE p.id = ?
    `).get(result.lastInsertRowid);

    res.status(201).json(post);
  } catch (e) {
    console.error("发帖失败:", e.message);
    res.status(500).json({ error: "发帖失败" });
  }
});

// 删除动态（管理员+超管）
app.delete("/api/posts/:id", requireAdmin, (req, res) => {
  const id = parseInt(req.params.id);
  const post = db.prepare("SELECT * FROM posts WHERE id = ?").get(id);
  if (!post) return res.status(404).json({ error: "动态不存在" });

  if (post.image) {
    fs.unlink(path.join(__dirname, "public", post.image), () => {});
  }
  if (post.thumbnail) {
    fs.unlink(path.join(__dirname, "public", post.thumbnail), () => {});
  }

  db.prepare("DELETE FROM likes WHERE post_id = ?").run(id);
  db.prepare("DELETE FROM posts WHERE id = ?").run(id);
  res.json({ message: "已删除" });
});

// ========== 点赞 API ==========

app.post("/api/posts/:id/like", requireLogin, (req, res) => {
  const postId = parseInt(req.params.id);
  const post = db.prepare("SELECT id FROM posts WHERE id = ?").get(postId);
  if (!post) return res.status(404).json({ error: "动态不存在" });

  const existing = db.prepare("SELECT id FROM likes WHERE post_id = ? AND user_id = ?").get(postId, req.user.id);
  if (existing) {
    db.prepare("DELETE FROM likes WHERE post_id = ? AND user_id = ?").run(postId, req.user.id);
  } else {
    db.prepare("INSERT INTO likes (post_id, user_id) VALUES (?, ?)").run(postId, req.user.id);
  }

  const count = db.prepare("SELECT COUNT(*) as count FROM likes WHERE post_id = ?").get(postId).count;
  const liked = !existing;
  res.json({ liked, count });
});

// ========== 页面路由 ==========
app.get("/post/:id", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

// ========== 错误处理 ==========
app.use((err, req, res, next) => {
  if (err.code === "LIMIT_FILE_SIZE") return res.status(400).json({ error: "图片不能超过 5MB" });
  console.error("服务器错误:", err.message);
  res.status(500).json({ error: err.message || "服务器内部错误" });
});

app.listen(PORT, () => {
  console.log(`🚀 个人空间已启动: http://localhost:${PORT}`);
});
