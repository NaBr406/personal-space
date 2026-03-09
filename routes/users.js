function registerUserRoutes({
  app,
  db,
  upload,
  requireLogin,
  requireSuperAdmin,
  getUser,
  publicDir,
  path,
  fs,
  bcrypt,
  crypto,
}) {
  app.get('/api/me', requireLogin, (req, res) => {
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate');
    res.set('Pragma', 'no-cache');
    res.set('Expires', '0');
    res.json(req.user);
  });

  app.put('/api/me', requireLogin, upload.single('avatar'), (req, res) => {
    const nickname = (req.body.nickname || '').trim();
    const avatar = req.file ? `/uploads/${req.file.filename}` : null;

    if (nickname) db.prepare('UPDATE users SET nickname = ? WHERE id = ?').run(nickname, req.user.id);
    if (avatar) {
      const old = db.prepare('SELECT avatar FROM users WHERE id = ?').get(req.user.id);
      if (old && old.avatar && old.avatar !== '/default-avatar.png' && old.avatar.startsWith('/uploads/')) {
        const oldPath = path.join(publicDir, old.avatar);
        fs.unlink(oldPath, () => {});
      }
      db.prepare('UPDATE users SET avatar = ? WHERE id = ?').run(avatar, req.user.id);
    }

    const updated = db.prepare('SELECT id, username, nickname, avatar, role FROM users WHERE id = ?').get(req.user.id);
    res.json(updated);
  });

  app.post('/api/change-password-direct', requireLogin, async (req, res) => {
    const { newPassword } = req.body;
    if (!newPassword || newPassword.length < 4) return res.status(400).json({ error: '密码至少 4 位' });
    const hash = await bcrypt.hash(newPassword, 10);
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hash, req.user.id);
    res.json({ ok: true });
  });

  app.post('/api/change-password', requireLogin, async (req, res) => {
    const { oldPassword, newPassword } = req.body;
    if (!oldPassword || !newPassword) return res.status(400).json({ error: '请输入旧密码和新密码' });
    if (newPassword.length < 4) return res.status(400).json({ error: '新密码至少 4 位' });

    const user = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(req.user.id);
    if (!await bcrypt.compare(oldPassword, user.password_hash)) {
      return res.status(403).json({ error: '旧密码错误' });
    }

    const hash = await bcrypt.hash(newPassword, 10);
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hash, req.user.id);
    res.json({ ok: true });
  });

  app.get('/api/users', requireSuperAdmin, (req, res) => {
    const users = db.prepare('SELECT id, username, nickname, avatar, role, created_at FROM users ORDER BY created_at DESC').all();
    res.json(users);
  });

  app.put('/api/users/:id/role', requireSuperAdmin, (req, res) => {
    const id = parseInt(req.params.id);
    const { role } = req.body;
    if (!['guest', 'admin'].includes(role)) return res.status(400).json({ error: '角色只能是 guest 或 admin' });

    const target = db.prepare('SELECT id, role FROM users WHERE id = ?').get(id);
    if (!target) return res.status(404).json({ error: '用户不存在' });
    if (target.role === 'superadmin') return res.status(403).json({ error: '不能修改超级管理员' });

    db.prepare('UPDATE users SET role = ? WHERE id = ?').run(role, id);
    res.json({ ok: true });
  });

  app.get('/api/invite-code', requireSuperAdmin, (req, res) => {
    const today = new Date().toISOString().slice(0, 10);
    let code = db.prepare('SELECT code FROM invite_codes WHERE created_date = ? AND used_by IS NULL').get(today);
    if (!code) {
      const newCode = crypto.randomBytes(4).toString('hex').toUpperCase();
      db.prepare('INSERT INTO invite_codes (code, created_date) VALUES (?, ?)').run(newCode, today);
      code = { code: newCode };
    }
    res.json({ code: code.code, date: today });
  });

  app.post('/api/invite-code/refresh', requireSuperAdmin, (req, res) => {
    const today = new Date().toISOString().slice(0, 10);
    db.prepare('DELETE FROM invite_codes WHERE created_date = ? AND used_by IS NULL').run(today);
    const newCode = crypto.randomBytes(4).toString('hex').toUpperCase();
    db.prepare('INSERT INTO invite_codes (code, created_date) VALUES (?, ?)').run(newCode, today);
    res.json({ code: newCode, date: today });
  });

  app.delete('/api/users/:id', requireSuperAdmin, (req, res) => {
    const id = parseInt(req.params.id);
    const target = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
    if (!target) return res.status(404).json({ error: '用户不存在' });
    if (target.role === 'superadmin') return res.status(403).json({ error: '不能删除超级管理员' });

    const posts = db.prepare('SELECT image, thumbnail FROM posts WHERE user_id = ?').all(id);
    const deleteUserTx = db.transaction(() => {
      db.prepare('DELETE FROM notifications WHERE user_id = ? OR from_user_id = ?').run(id, id);
      db.prepare('DELETE FROM likes WHERE user_id = ?').run(id);
      db.prepare('DELETE FROM comments WHERE user_id = ?').run(id);
      db.prepare('DELETE FROM sessions WHERE user_id = ?').run(id);
      db.prepare('DELETE FROM password_reset_codes WHERE user_id = ?').run(id);
      db.prepare('DELETE FROM invite_codes WHERE used_by = ?').run(id);
      db.prepare('DELETE FROM posts WHERE user_id = ?').run(id);
      db.prepare('DELETE FROM users WHERE id = ?').run(id);
    });
    deleteUserTx();
    for (const post of posts) {
      if (post.image) fs.unlink(path.join(publicDir, post.image), () => {});
      if (post.thumbnail) fs.unlink(path.join(publicDir, post.thumbnail), () => {});
    }
    res.json({ message: '用户已删除' });
  });

  app.post('/api/users/:id/reset-code', requireSuperAdmin, (req, res) => {
    const userId = parseInt(req.params.id);
    const user = db.prepare('SELECT id FROM users WHERE id = ?').get(userId);
    if (!user) return res.status(404).json({ error: '用户不存在' });
    db.prepare('UPDATE password_reset_codes SET used = 1 WHERE user_id = ? AND used = 0').run(userId);
    const code = crypto.randomBytes(4).toString('hex').toUpperCase();
    db.prepare('INSERT INTO password_reset_codes (user_id, code) VALUES (?, ?)').run(userId, code);
    res.json({ code });
  });

  app.get('/api/users/:id/reset-code', requireSuperAdmin, (req, res) => {
    const userId = parseInt(req.params.id);
    const row = db.prepare('SELECT code FROM password_reset_codes WHERE user_id = ? AND used = 0 ORDER BY id DESC LIMIT 1').get(userId);
    res.json({ code: row ? row.code : null });
  });

  app.post('/api/reset-password', async (req, res) => {
    const { username, code, newPassword } = req.body;
    if (!username || !code || !newPassword) return res.status(400).json({ error: '请填写完整' });
    if (newPassword.length < 4) return res.status(400).json({ error: '密码至少 4 位' });
    const user = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
    if (!user) return res.status(404).json({ error: '用户不存在' });
    const resetCode = db.prepare('SELECT id FROM password_reset_codes WHERE user_id = ? AND code = ? AND used = 0').get(user.id, code.toUpperCase());
    if (!resetCode) return res.status(403).json({ error: '校验码无效或已使用' });
    const hash = await bcrypt.hash(newPassword, 10);
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hash, user.id);
    db.prepare('UPDATE password_reset_codes SET used = 1 WHERE id = ?').run(resetCode.id);
    res.json({ ok: true });
  });

  app.post('/api/visit', (req, res) => {
    const user = getUser(req);
    const ip = req.headers['x-forwarded-for'] || req.headers['x-real-ip'] || req.connection.remoteAddress || '';
    const realIp = ip.split(',')[0].trim().replace('::ffff:', '');
    const ua = (req.headers['user-agent'] || '').slice(0, 200);
    const recent = user
      ? db.prepare("SELECT 1 FROM visitors WHERE user_id = ? AND visited_at > datetime('now','localtime','-5 minutes')").get(user.id)
      : db.prepare("SELECT 1 FROM visitors WHERE user_id IS NULL AND ip = ? AND visited_at > datetime('now','localtime','-5 minutes')").get(realIp);
    if (!recent) {
      db.prepare('INSERT INTO visitors (user_id, ip, user_agent) VALUES (?, ?, ?)').run(user ? user.id : null, realIp, ua);
    }
    res.json({ ok: true });
  });

  app.get('/api/visitors', requireSuperAdmin, (req, res) => {
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
}

module.exports = { registerUserRoutes };
