const express = require("express");
const path = require("path");
const fs = require("fs");
const bcrypt = require("bcryptjs");
const crypto = require("crypto");

const config = require("./config");
const { initDatabase } = require("./db");
const app = express();
const PORT = config.port;

// ========== 数据库初始化 ==========
const db = initDatabase(config);

// ========== 中间件 ==========
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(config.publicDir));

// ========== 图片上传 ==========
const { createUploadService } = require("./services/uploads");
const { upload, generateThumbnail } = createUploadService(config);

// ========== Token 认证中间件 ==========
const { createAuthMiddleware } = require("./middleware/auth");
const { getUser, requireLogin, requireAdmin, requireSuperAdmin } = createAuthMiddleware(db);

// ========== 认证 API ==========


// ========== 频率限制 ==========
const rateLimitMap = new Map();
function rateLimit(key, maxAttempts, windowMs) {
  const now = Date.now();
  const entry = rateLimitMap.get(key);
  if (!entry || now - entry.start > windowMs) {
    rateLimitMap.set(key, { start: now, count: 1 });
    return false;
  }
  entry.count++;
  if (entry.count > maxAttempts) return true;
  return false;
}
// 定期清理
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of rateLimitMap) {
    if (now - v.start > 600000) rateLimitMap.delete(k);
  }
}, 300000);

// ========== 验证码 ==========
const captchaStore = new Map(); // token -> { answer, expires }
const CAPTCHA_MAX = 5000;
// 定期清理过期验证码
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of captchaStore) {
    if (v.expires < now) captchaStore.delete(k);
  }
}, 60000);

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
  if (captchaStore.size >= CAPTCHA_MAX) {
    // 强制清理
    const now = Date.now();
    for (const [k, v] of captchaStore) { if (v.expires < now) captchaStore.delete(k); }
    if (captchaStore.size >= CAPTCHA_MAX) return res.status(429).json({ error: "服务繁忙，请稍后再试" });
  }
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
app.post("/api/register", async (req, res) => {
  const regIp = req.headers["x-forwarded-for"]?.split(",")[0]?.trim() || req.ip;
  if (rateLimit("register:" + regIp, 5, 60000)) return res.status(429).json({ error: "注册请求过于频繁，请稍后再试" });

  // 邀请码校验
  const { inviteCode } = req.body;
  if (!inviteCode) return res.status(400).json({ error: "请填写邀请码" });
  const today = new Date().toISOString().slice(0, 10);
  const validCode = db.prepare("SELECT id, code FROM invite_codes WHERE code = ? AND created_date = ? AND used_by IS NULL").get(inviteCode.trim().toUpperCase(), today);
  if (!validCode) return res.status(400).json({ error: "邀请码无效或已过期" });

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

  const hash = await bcrypt.hash(password, 10);
  const token = crypto.randomBytes(32).toString("hex");
  const displayName = (nickname || "").trim() || username;

  const result = db.prepare("INSERT INTO users (username, password_hash, nickname, register_ip) VALUES (?, ?, ?, ?)").run(username, hash, displayName, clientIp);
  const regTokenHash = crypto.createHash("sha256").update(token).digest("hex");
  db.prepare("INSERT INTO sessions (user_id, token_hash) VALUES (?, ?)").run(result.lastInsertRowid, regTokenHash);
  // 标记邀请码已使用
  db.prepare("UPDATE invite_codes SET used_by = ?, used_at = datetime('now', 'localtime') WHERE code = ? AND created_date = ? AND used_by IS NULL").run(result.lastInsertRowid, inviteCode.trim().toUpperCase(), today);
  const user = db.prepare("SELECT id, username, nickname, avatar, role FROM users WHERE id = ?").get(result.lastInsertRowid);

  res.status(201).json({ ...user, token });
});

// 登录
app.post("/api/login", async (req, res) => {
  const loginIp = req.headers["x-forwarded-for"]?.split(",")[0]?.trim() || req.ip;
  if (rateLimit("login:" + loginIp, 10, 60000)) return res.status(429).json({ error: "登录尝试过于频繁，请稍后再试" });
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: "用户名和密码必填" });

  const user = db.prepare("SELECT * FROM users WHERE username = ?").get(username);
  if (!user || !await bcrypt.compare(password, user.password_hash)) {
    return res.status(403).json({ error: "用户名或密码错误" });
  }

  const token = crypto.randomBytes(32).toString("hex");
  const loginTokenHash = crypto.createHash("sha256").update(token).digest("hex");
  db.prepare("INSERT INTO sessions (user_id, token_hash) VALUES (?, ?)").run(user.id, loginTokenHash);

  res.json({ id: user.id, username: user.username, nickname: user.nickname, avatar: user.avatar, role: user.role, token });
});

// 获取当前用户信息
app.get("/api/me", requireLogin, (req, res) => {
  res.set("Cache-Control", "no-store, no-cache, must-revalidate");
  res.set("Pragma", "no-cache");
  res.set("Expires", "0");
  res.json(req.user);
});

// 修改个人信息（昵称、头像）
app.put("/api/me", requireLogin, upload.single("avatar"), (req, res) => {
  const nickname = (req.body.nickname || "").trim();
  const avatar = req.file ? `/uploads/${req.file.filename}` : null;

  if (nickname) db.prepare("UPDATE users SET nickname = ? WHERE id = ?").run(nickname, req.user.id);
  if (avatar) {
    // 删除旧头像文件（保护默认头像）
    const old = db.prepare("SELECT avatar FROM users WHERE id = ?").get(req.user.id);
    if (old && old.avatar && old.avatar !== "/default-avatar.png" && old.avatar.startsWith("/uploads/")) {
      const oldPath = path.join(config.publicDir, old.avatar);
      fs.unlink(oldPath, () => {});
    }
    db.prepare("UPDATE users SET avatar = ? WHERE id = ?").run(avatar, req.user.id);
  }

  const updated = db.prepare("SELECT id, username, nickname, avatar, role FROM users WHERE id = ?").get(req.user.id);
  res.json(updated);
});

// 直接修改密码（已登录）
app.post("/api/change-password-direct", requireLogin, async (req, res) => {
  const { newPassword } = req.body;
  if (!newPassword || newPassword.length < 4) return res.status(400).json({ error: "密码至少 4 位" });
  const hash = await bcrypt.hash(newPassword, 10);
  db.prepare("UPDATE users SET password_hash = ? WHERE id = ?").run(hash, req.user.id);
  res.json({ ok: true });
});

// 修改密码
app.post("/api/change-password", requireLogin, async (req, res) => {
  const { oldPassword, newPassword } = req.body;
  if (!oldPassword || !newPassword) return res.status(400).json({ error: "请输入旧密码和新密码" });
  if (newPassword.length < 4) return res.status(400).json({ error: "新密码至少 4 位" });

  const user = db.prepare("SELECT password_hash FROM users WHERE id = ?").get(req.user.id);
  if (!await bcrypt.compare(oldPassword, user.password_hash)) {
    return res.status(403).json({ error: "旧密码错误" });
  }

  const hash = await bcrypt.hash(newPassword, 10);
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
// 获取今日邀请码（超管）
app.get("/api/invite-code", requireSuperAdmin, (req, res) => {
  const today = new Date().toISOString().slice(0, 10);
  let code = db.prepare("SELECT code FROM invite_codes WHERE created_date = ? AND used_by IS NULL").get(today);
  if (!code) {
    // 生成新的
    const newCode = crypto.randomBytes(4).toString("hex").toUpperCase();
    db.prepare("INSERT INTO invite_codes (code, created_date) VALUES (?, ?)").run(newCode, today);
    code = { code: newCode };
  }
  res.json({ code: code.code, date: today });
});

// 手动刷新邀请码（超管）
app.post("/api/invite-code/refresh", requireSuperAdmin, (req, res) => {
  const today = new Date().toISOString().slice(0, 10);
  // 作废今天未使用的旧码
  db.prepare("DELETE FROM invite_codes WHERE created_date = ? AND used_by IS NULL").run(today);
  const newCode = crypto.randomBytes(4).toString("hex").toUpperCase();
  db.prepare("INSERT INTO invite_codes (code, created_date) VALUES (?, ?)").run(newCode, today);
  res.json({ code: newCode, date: today });
});

app.delete("/api/users/:id", requireSuperAdmin, (req, res) => {
  const id = parseInt(req.params.id);
  const target = db.prepare("SELECT * FROM users WHERE id = ?").get(id);
  if (!target) return res.status(404).json({ error: "用户不存在" });
  if (target.role === "superadmin") return res.status(403).json({ error: "不能删除超级管理员" });

  // 删除用户（事务保护）
  const posts = db.prepare("SELECT * FROM posts WHERE user_id = ?").all(id);
  const deleteUserTx = db.transaction(() => {
    db.prepare("DELETE FROM notifications WHERE user_id = ? OR from_user_id = ?").run(id, id);
    db.prepare("DELETE FROM comments WHERE user_id = ?").run(id);
    db.prepare("DELETE FROM sessions WHERE user_id = ?").run(id);
    db.prepare("DELETE FROM likes WHERE user_id = ?").run(id);
    for (const post of posts) {
      db.prepare("DELETE FROM comments WHERE post_id = ?").run(post.id);
      db.prepare("DELETE FROM likes WHERE post_id = ?").run(post.id);
    }
    db.prepare("DELETE FROM posts WHERE user_id = ?").run(id);
    db.prepare("DELETE FROM users WHERE id = ?").run(id);
  });
  deleteUserTx();
  // 清理图片文件（事务外，不影响数据一致性）
  for (const post of posts) {
    if (post.image) fs.unlink(path.join(config.publicDir, post.image), () => {});
    if (post.thumbnail) fs.unlink(path.join(config.publicDir, post.thumbnail), () => {});
  }

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
    (SELECT COUNT(*) FROM likes WHERE post_id = p.id) as like_count,
    (SELECT COUNT(*) FROM comments WHERE post_id = p.id) as comment_count
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
    (SELECT COUNT(*) FROM likes WHERE post_id = p.id) as like_count,
    (SELECT COUNT(*) FROM comments WHERE post_id = p.id) as comment_count
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
app.post("/api/posts", requireAdmin, upload.array("images", 9), async (req, res) => {
  try {
    const content = (req.body.content || "").trim() || null;
    const files = req.files || [];
    if (!content && !files.length) return res.status(400).json({ error: "内容和图片至少需要一个" });

    const imageList = files.map(f => `/uploads/${f.filename}`);
    const thumbList = [];
    for (const f of files) {
      const t = await generateThumbnail(f.path);
      thumbList.push(t || `/uploads/${f.filename}`);
    }

    const image = imageList[0] || null;
    const thumbnail = thumbList[0] || null;
    const images = imageList.length ? JSON.stringify(imageList) : null;
    const thumbnails = thumbList.length ? JSON.stringify(thumbList) : null;

    const result = db.prepare("INSERT INTO posts (content, image, thumbnail, images, thumbnails, user_id, created_at) VALUES (?, ?, ?, ?, ?, ?, datetime('now', 'localtime'))").run(content, image, thumbnail, images, thumbnails, req.user.id);
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
    fs.unlink(path.join(config.publicDir, post.image), () => {});
  }
  if (post.thumbnail) {
    fs.unlink(path.join(config.publicDir, post.thumbnail), () => {});
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

  const toggleLike = db.transaction(() => {
    const existing = db.prepare("SELECT id FROM likes WHERE post_id = ? AND user_id = ?").get(postId, req.user.id);
    if (existing) {
      db.prepare("DELETE FROM likes WHERE post_id = ? AND user_id = ?").run(postId, req.user.id);
    } else {
      db.prepare("INSERT OR IGNORE INTO likes (post_id, user_id) VALUES (?, ?)").run(postId, req.user.id);
    }
    const count = db.prepare("SELECT COUNT(*) as count FROM likes WHERE post_id = ?").get(postId).count;
    return { liked: !existing, count };
  });
  const result = toggleLike();
  res.json(result);
});



// 生成密码重置校验码（超管）
app.post("/api/users/:id/reset-code", requireSuperAdmin, (req, res) => {
  const userId = parseInt(req.params.id);
  const user = db.prepare("SELECT id FROM users WHERE id = ?").get(userId);
  if (!user) return res.status(404).json({ error: "用户不存在" });
  db.prepare("UPDATE password_reset_codes SET used = 1 WHERE user_id = ? AND used = 0").run(userId);
  const code = crypto.randomBytes(4).toString("hex").toUpperCase();
  db.prepare("INSERT INTO password_reset_codes (user_id, code) VALUES (?, ?)").run(userId, code);
  res.json({ code });
});

// 获取用户的有效校验码（超管）
app.get("/api/users/:id/reset-code", requireSuperAdmin, (req, res) => {
  const userId = parseInt(req.params.id);
  const row = db.prepare("SELECT code FROM password_reset_codes WHERE user_id = ? AND used = 0 ORDER BY id DESC LIMIT 1").get(userId);
  res.json({ code: row ? row.code : null });
});

// 用校验码重置密码（无需登录）
app.post("/api/reset-password", async (req, res) => {
  const { username, code, newPassword } = req.body;
  if (!username || !code || !newPassword) return res.status(400).json({ error: "请填写完整" });
  if (newPassword.length < 4) return res.status(400).json({ error: "密码至少 4 位" });
  const user = db.prepare("SELECT id FROM users WHERE username = ?").get(username);
  if (!user) return res.status(404).json({ error: "用户不存在" });
  const resetCode = db.prepare("SELECT id FROM password_reset_codes WHERE user_id = ? AND code = ? AND used = 0").get(user.id, code.toUpperCase());
  if (!resetCode) return res.status(403).json({ error: "校验码无效或已使用" });
  const hash = await bcrypt.hash(newPassword, 10);
  db.prepare("UPDATE users SET password_hash = ? WHERE id = ?").run(hash, user.id);
  db.prepare("UPDATE password_reset_codes SET used = 1 WHERE id = ?").run(resetCode.id);
  res.json({ ok: true });
});


// ========== 评论 API ==========

// 获取动态的评论
app.get("/api/posts/:id/comments", (req, res) => {
  const postId = parseInt(req.params.id);
  const comments = db.prepare(`
    SELECT c.*, u.nickname, u.avatar,
    ru.nickname as reply_to_nickname
    FROM comments c
    LEFT JOIN users u ON c.user_id = u.id
    LEFT JOIN users ru ON c.reply_to_user_id = ru.id
    WHERE c.post_id = ? ORDER BY c.created_at ASC
  `).all(postId);
  res.json(comments);
});

// 发表评论
app.post("/api/posts/:id/comments", requireLogin, (req, res) => {
  const postId = parseInt(req.params.id);
  const { content } = req.body;
  if (!content || !content.trim()) return res.status(400).json({ error: "评论内容不能为空" });
  if (content.length > 500) return res.status(400).json({ error: "评论不能超过 500 字" });

  const post = db.prepare("SELECT id, user_id FROM posts WHERE id = ?").get(postId);
  if (!post) return res.status(404).json({ error: "动态不存在" });

  const parentId = req.body.parent_id ? parseInt(req.body.parent_id) : null;
  let replyToUserId = null;

  if (parentId) {
    const parentComment = db.prepare("SELECT * FROM comments WHERE id = ? AND post_id = ?").get(parentId, postId);
    if (!parentComment) return res.status(400).json({ error: "回复的评论不存在" });
    replyToUserId = parentComment.user_id;
  }

  const result = db.prepare("INSERT INTO comments (post_id, user_id, content, parent_id, reply_to_user_id) VALUES (?, ?, ?, ?, ?)").run(postId, req.user.id, content.trim(), parentId, replyToUserId);

  // 通知：回复评论通知被回复者，否则通知动态作者（不通知自己）
  if (replyToUserId && replyToUserId !== req.user.id) {
    db.prepare("INSERT INTO notifications (user_id, type, from_user_id, post_id, comment_id, content) VALUES (?, 'reply', ?, ?, ?, ?)").run(
      replyToUserId, req.user.id, postId, result.lastInsertRowid, content.trim().slice(0, 100)
    );
  }
  if (post.user_id && post.user_id !== req.user.id && post.user_id !== replyToUserId) {
    db.prepare("INSERT INTO notifications (user_id, type, from_user_id, post_id, comment_id, content) VALUES (?, 'comment', ?, ?, ?, ?)").run(
      post.user_id, req.user.id, postId, result.lastInsertRowid, content.trim().slice(0, 100)
    );
  }

  const comment = db.prepare(`
    SELECT c.*, u.nickname, u.avatar,
    ru.nickname as reply_to_nickname
    FROM comments c
    LEFT JOIN users u ON c.user_id = u.id
    LEFT JOIN users ru ON c.reply_to_user_id = ru.id
    WHERE c.id = ?
  `).get(result.lastInsertRowid);

  res.json(comment);
});

// 删除评论（作者或超管）
app.delete("/api/comments/:id", requireLogin, (req, res) => {
  const commentId = parseInt(req.params.id);
  const comment = db.prepare("SELECT * FROM comments WHERE id = ?").get(commentId);
  if (!comment) return res.status(404).json({ error: "评论不存在" });
  if (comment.user_id !== req.user.id && req.user.role !== "superadmin" && req.user.role !== "admin") {
    return res.status(403).json({ error: "无权删除" });
  }
  // 删除子回复的通知和子回复
  const childIds = db.prepare("SELECT id FROM comments WHERE parent_id = ?").all(commentId).map(r => r.id);
  for (const cid of childIds) {
    db.prepare("DELETE FROM notifications WHERE comment_id = ?").run(cid);
  }
  db.prepare("DELETE FROM comments WHERE parent_id = ?").run(commentId);
  db.prepare("DELETE FROM notifications WHERE comment_id = ?").run(commentId);
  db.prepare("DELETE FROM comments WHERE id = ?").run(commentId);
  res.json({ ok: true });
});

// 公告页面路由
app.get("/announcements", (req, res) => {
  res.sendFile(path.join(config.publicDir, "announcements.html"));
});

// ========== 公告 API ==========

// 获取公告列表
app.get("/api/announcements", (req, res) => {
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 20;
  const offset = (page - 1) * limit;
  const total = db.prepare("SELECT COUNT(*) as c FROM announcements").get().c;
  const list = db.prepare(`
    SELECT a.*, u.nickname as author_name, u.avatar as author_avatar
    FROM announcements a LEFT JOIN users u ON a.user_id = u.id
    ORDER BY a.pinned DESC, a.created_at DESC
    LIMIT ? OFFSET ?
  `).all(limit, offset);
  res.json({ announcements: list, pagination: { page, limit, total, pages: Math.ceil(total / limit) } });
});

// 获取单条公告
app.get("/api/announcements/:id", (req, res) => {
  const a = db.prepare(`
    SELECT a.*, u.nickname as author_name, u.avatar as author_avatar
    FROM announcements a LEFT JOIN users u ON a.user_id = u.id
    WHERE a.id = ?
  `).get(parseInt(req.params.id));
  if (!a) return res.status(404).json({ error: "公告不存在" });
  res.json(a);
});

// 发布公告（仅超管）
app.post("/api/announcements", requireLogin, (req, res) => {
  if (req.user.role !== "superadmin") return res.status(403).json({ error: "仅超管可发布公告" });
  const { title, content, pinned } = req.body;
  if (!title || !title.trim()) return res.status(400).json({ error: "标题不能为空" });
  if (!content || !content.trim()) return res.status(400).json({ error: "内容不能为空" });
  const result = db.prepare("INSERT INTO announcements (user_id, title, content, pinned) VALUES (?, ?, ?, ?)").run(
    req.user.id, title.trim(), content.trim(), pinned ? 1 : 0
  );
  const a = db.prepare("SELECT * FROM announcements WHERE id = ?").get(result.lastInsertRowid);
  res.json(a);
});

// 删除公告（仅超管）
app.delete("/api/announcements/:id", requireLogin, (req, res) => {
  if (req.user.role !== "superadmin") return res.status(403).json({ error: "仅超管可删除公告" });
  const a = db.prepare("SELECT * FROM announcements WHERE id = ?").get(parseInt(req.params.id));
  if (!a) return res.status(404).json({ error: "公告不存在" });
  db.prepare("DELETE FROM announcements WHERE id = ?").run(a.id);
  res.json({ ok: true });
});

// 置顶/取消置顶公告（仅超管）
app.patch("/api/announcements/:id/pin", requireLogin, (req, res) => {
  if (req.user.role !== "superadmin") return res.status(403).json({ error: "仅超管可操作" });
  const a = db.prepare("SELECT * FROM announcements WHERE id = ?").get(parseInt(req.params.id));
  if (!a) return res.status(404).json({ error: "公告不存在" });
  db.prepare("UPDATE announcements SET pinned = ? WHERE id = ?").run(a.pinned ? 0 : 1, a.id);
  res.json({ ok: true, pinned: !a.pinned });
});

// ========== 通知 API ==========

// 获取通知列表
app.get("/api/notifications", requireLogin, (req, res) => {
  const notifications = db.prepare(`
    SELECT n.*, u.nickname as from_nickname, u.avatar as from_avatar,
    p.content as post_content
    FROM notifications n
    LEFT JOIN users u ON n.from_user_id = u.id
    LEFT JOIN posts p ON n.post_id = p.id
    WHERE n.user_id = ?
    ORDER BY n.created_at DESC
    LIMIT 50
  `).all(req.user.id);
  res.json(notifications);
});

// 未读通知数
app.get("/api/notifications/unread-count", requireLogin, (req, res) => {
  const row = db.prepare("SELECT COUNT(*) as count FROM notifications WHERE user_id = ? AND is_read = 0").get(req.user.id);
  res.json({ count: row.count });
});

// 标记全部已读
app.post("/api/notifications/read-all", requireLogin, (req, res) => {
  db.prepare("UPDATE notifications SET is_read = 1 WHERE user_id = ? AND is_read = 0").run(req.user.id);
  res.json({ ok: true });
});

// 标记单条已读
app.post("/api/notifications/:id/read", requireLogin, (req, res) => {
  const id = parseInt(req.params.id);
  db.prepare("UPDATE notifications SET is_read = 1 WHERE id = ? AND user_id = ?").run(id, req.user.id);
  res.json({ ok: true });
});

// 点赞时也发通知
// 登出
app.post("/api/logout", (req, res) => {
  const token = req.headers.authorization?.replace("Bearer ", "");
  if (token) {
    const logoutHash = crypto.createHash("sha256").update(token).digest("hex");
    db.prepare("DELETE FROM sessions WHERE token_hash = ?").run(logoutHash);
  }
  res.json({ message: "已登出" });
});

// ========== 访客记录 ==========

// 记录访问（任何人）
app.post("/api/visit", (req, res) => {
  const user = getUser(req);
  const ip = req.headers["x-forwarded-for"] || req.headers["x-real-ip"] || req.connection.remoteAddress || "";
  const realIp = ip.split(",")[0].trim().replace("::ffff:", "");
  const ua = (req.headers["user-agent"] || "").slice(0, 200);
  // 5分钟内同一用户/IP只记录一次
  const recent = user
    ? db.prepare("SELECT 1 FROM visitors WHERE user_id = ? AND visited_at > datetime('now','localtime','-5 minutes')").get(user.id)
    : db.prepare("SELECT 1 FROM visitors WHERE user_id IS NULL AND ip = ? AND visited_at > datetime('now','localtime','-5 minutes')").get(realIp);
  if (!recent) {
    db.prepare("INSERT INTO visitors (user_id, ip, user_agent) VALUES (?, ?, ?)").run(user ? user.id : null, realIp, ua);
  }
  res.json({ ok: true });
});

// 查询访客（超管）
app.get("/api/visitors", requireSuperAdmin, (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 50, 200);
  const visitors = db.prepare(`
    SELECT v.id, v.user_id, v.ip, v.visited_at,
      u.nickname, u.avatar
    FROM visitors v
    LEFT JOIN users u ON v.user_id = u.id
    ORDER BY v.visited_at DESC
    LIMIT ?
  `).all(limit);
  res.json(visitors);
});

// ========== 页面路由 ==========
app.get("/post/:id", (req, res) => {
  res.sendFile(path.join(config.publicDir, "index.html"));
});



// ========== 图片上传 API（Vditor 编辑器用） ==========
app.post("/api/upload-image", requireSuperAdmin, upload.single("image"), async (req, res) => {
  if (!req.file) return res.status(400).json({ msg: "请选择图片" });
  try {
    const thumb = await generateThumbnail(req.file.path);
    // Vditor 要求的返回格式
    res.json({
      msg: "",
      code: 0,
      data: {
        errFiles: [],
        succMap: {
          [req.file.originalname]: "/uploads/" + req.file.filename
        }
      }
    });
  } catch (e) {
    res.json({
      msg: "",
      code: 0,
      data: {
        errFiles: [],
        succMap: {
          [req.file.originalname]: "/uploads/" + req.file.filename
        }
      }
    });
  }
});

// ========== 文章 API（博客+杂谈） ==========

// 文章列表
app.get("/api/articles", (req, res) => {
  const category = req.query.category;
  if (!category || !['blog', 'chitchat'].includes(category)) {
    return res.status(400).json({ error: "category 必须是 blog 或 chitchat" });
  }
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const limit = Math.min(50, Math.max(1, parseInt(req.query.limit) || 10));
  const offset = (page - 1) * limit;

  const articles = db.prepare(`
    SELECT a.*, u.nickname as author_name, u.avatar as author_avatar
    FROM articles a LEFT JOIN users u ON a.user_id = u.id
    WHERE a.category = ?
    ORDER BY a.created_at DESC LIMIT ? OFFSET ?
  `).all(category, limit, offset);

  const total = db.prepare("SELECT COUNT(*) as count FROM articles WHERE category = ?").get(category).count;
  res.json({ articles, pagination: { page, limit, total, pages: Math.ceil(total / limit) } });
});

// 单篇文章
app.get("/api/articles/:id", (req, res) => {
  const a = db.prepare(`
    SELECT a.*, u.nickname as author_name, u.avatar as author_avatar
    FROM articles a LEFT JOIN users u ON a.user_id = u.id
    WHERE a.id = ?
  `).get(parseInt(req.params.id));
  if (!a) return res.status(404).json({ error: "文章不存在" });
  res.json(a);
});

// 文章浏览计数
app.post("/api/articles/:id/view", (req, res) => {
  const id = parseInt(req.params.id);
  db.prepare("UPDATE articles SET views = views + 1 WHERE id = ?").run(id);
  const a = db.prepare("SELECT views FROM articles WHERE id = ?").get(id);
  res.json({ views: a ? a.views : 0 });
});

// 发布文章（仅超管）
app.post("/api/articles", requireSuperAdmin, upload.single("cover"), (req, res) => {
  const { title, content, summary, category } = req.body;
  if (!title || !title.trim()) return res.status(400).json({ error: "标题不能为空" });
  if (!content || !content.trim()) return res.status(400).json({ error: "内容不能为空" });
  if (!category || !['blog', 'chitchat'].includes(category)) return res.status(400).json({ error: "分类无效" });

  const coverImage = req.file ? "/uploads/" + req.file.filename : null;
  const result = db.prepare(
    "INSERT INTO articles (category, title, content, summary, cover_image, user_id) VALUES (?, ?, ?, ?, ?, ?)" ).run(category, title.trim(), content.trim(), (summary || '').trim() || null, coverImage, req.user.id);

  const a = db.prepare("SELECT * FROM articles WHERE id = ?").get(result.lastInsertRowid);
  res.status(201).json(a);
});

// 编辑文章（仅超管）
app.put("/api/articles/:id", requireSuperAdmin, upload.single("cover"), (req, res) => {
  const id = parseInt(req.params.id);
  const existing = db.prepare("SELECT * FROM articles WHERE id = ?").get(id);
  if (!existing) return res.status(404).json({ error: "文章不存在" });

  const { title, content, summary } = req.body;
  if (!title || !title.trim()) return res.status(400).json({ error: "标题不能为空" });
  if (!content || !content.trim()) return res.status(400).json({ error: "内容不能为空" });

  const coverImage = req.file ? "/uploads/" + req.file.filename : existing.cover_image;
  db.prepare(
    "UPDATE articles SET title = ?, content = ?, summary = ?, cover_image = ?, updated_at = datetime('now', 'localtime') WHERE id = ?"
  ).run(title.trim(), content.trim(), (summary || '').trim() || null, coverImage, id);

  const a = db.prepare("SELECT * FROM articles WHERE id = ?").get(id);
  res.json(a);
});

// 删除文章（仅超管）
app.delete("/api/articles/:id", requireSuperAdmin, (req, res) => {
  const id = parseInt(req.params.id);
  const a = db.prepare("SELECT * FROM articles WHERE id = ?").get(id);
  if (!a) return res.status(404).json({ error: "文章不存在" });
  if (a.cover_image) {
    const coverPath = path.join(config.publicDir, a.cover_image);
    require("fs").unlink(coverPath, () => {});
  }
  db.prepare("DELETE FROM articles WHERE id = ?").run(id);
  res.json({ ok: true });
});

// 博客页面路由
app.get("/blog", (req, res) => {
  res.sendFile(path.join(config.publicDir, "blog.html"));
});
app.get("/blog/:id", (req, res) => {
  res.sendFile(path.join(config.publicDir, "blog.html"));
});

// 杂谈页面路由
app.get("/chitchat", (req, res) => {
  res.sendFile(path.join(config.publicDir, "chitchat.html"));
});
app.get("/chitchat/:id", (req, res) => {
  res.sendFile(path.join(config.publicDir, "chitchat.html"));
});

// ========== SPA fallback ==========
app.get('*', (req, res) => {
  res.sendFile(path.join(config.publicDir, 'index.html'));
});

// ========== 错误处理 ==========
app.use((err, req, res, next) => {
  if (err.code === "LIMIT_FILE_SIZE") return res.status(400).json({ error: "图片不能超过 100MB" });
  console.error("服务器错误:", err.message);
  res.status(500).json({ error: err.message || "服务器内部错误" });
});

app.listen(PORT, () => {
  console.log(`🚀 个人空间已启动 [${config.envName}]: http://localhost:${PORT}`);
});
