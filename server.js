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

// 获取当前用户信息等用户/管理员相关路由
const { registerUserRoutes } = require("./routes/users");
registerUserRoutes({
  app,
  db,
  upload,
  requireLogin,
  requireSuperAdmin,
  getUser,
  publicDir: config.publicDir,
  path,
  fs,
  bcrypt,
  crypto,
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
const { registerArticleRoutes } = require("./routes/articles");
registerArticleRoutes({
  app,
  db,
  upload,
  requireSuperAdmin,
  publicDir: config.publicDir,
  path,
  fs,
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
