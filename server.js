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
const { registerAuthRoutes } = require("./routes/auth");
registerAuthRoutes({ app, db, bcrypt, crypto });

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

// ========== 动态/点赞/评论/通知 API ==========
const { registerSocialRoutes } = require("./routes/social");
registerSocialRoutes({
  app,
  db,
  upload,
  generateThumbnail,
  getUser,
  requireLogin,
  requireAdmin,
  publicDir: config.publicDir,
  path,
  fs,
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
