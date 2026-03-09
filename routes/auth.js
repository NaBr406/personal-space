function registerAuthRoutes({ app, db, bcrypt, crypto }) {
  const rateLimitMap = new Map();
  function rateLimit(key, maxAttempts, windowMs) {
    const now = Date.now();
    const entry = rateLimitMap.get(key);
    if (!entry || now - entry.start > windowMs) {
      rateLimitMap.set(key, { start: now, count: 1 });
      return false;
    }
    entry.count++;
    return entry.count > maxAttempts;
  }
  setInterval(() => {
    const now = Date.now();
    for (const [k, v] of rateLimitMap) {
      if (now - v.start > 600000) rateLimitMap.delete(k);
    }
  }, 300000);

  const captchaStore = new Map();
  const CAPTCHA_MAX = 5000;
  setInterval(() => {
    const now = Date.now();
    for (const [k, v] of captchaStore) {
      if (v.expires < now) captchaStore.delete(k);
    }
  }, 60000);

  app.get('/api/captcha', (req, res) => {
    const a = Math.floor(Math.random() * 20) + 1;
    const b = Math.floor(Math.random() * 20) + 1;
    const ops = [
      { symbol: '+', answer: a + b },
      { symbol: '-', answer: Math.max(a, b) - Math.min(a, b) },
    ];
    const op = ops[Math.floor(Math.random() * ops.length)];
    const x = op.symbol === '-' ? Math.max(a, b) : a;
    const y = op.symbol === '-' ? Math.min(a, b) : b;
    if (captchaStore.size >= CAPTCHA_MAX) {
      const now = Date.now();
      for (const [k, v] of captchaStore) if (v.expires < now) captchaStore.delete(k);
      if (captchaStore.size >= CAPTCHA_MAX) return res.status(429).json({ error: '服务繁忙，请稍后再试' });
    }
    const question = `${x} ${op.symbol} ${y} = ?`;
    const token = crypto.randomBytes(16).toString('hex');
    captchaStore.set(token, { answer: op.answer, expires: Date.now() + 5 * 60 * 1000 });
    for (const [k, v] of captchaStore) {
      if (v.expires < Date.now()) captchaStore.delete(k);
    }
    res.json({ question, token });
  });

  app.post('/api/register', async (req, res) => {
    const regIp = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.ip;
    if (rateLimit('register:' + regIp, 5, 60000)) return res.status(429).json({ error: '注册请求过于频繁，请稍后再试' });

    const { inviteCode } = req.body;
    if (!inviteCode) return res.status(400).json({ error: '请填写邀请码' });
    const today = new Date().toISOString().slice(0, 10);
    const validCode = db.prepare('SELECT id, code FROM invite_codes WHERE code = ? AND created_date = ? AND used_by IS NULL').get(inviteCode.trim().toUpperCase(), today);
    if (!validCode) return res.status(400).json({ error: '邀请码无效或已过期' });

    const { captchaToken, captchaAnswer } = req.body;
    if (!captchaToken || captchaAnswer === undefined) return res.status(400).json({ error: '请完成验证码' });
    const cap = captchaStore.get(captchaToken);
    if (!cap) return res.status(400).json({ error: '验证码已过期，请刷新' });
    if (cap.expires < Date.now()) {
      captchaStore.delete(captchaToken);
      return res.status(400).json({ error: '验证码已过期，请刷新' });
    }
    if (parseInt(captchaAnswer) !== cap.answer) return res.status(400).json({ error: '验证码错误' });
    captchaStore.delete(captchaToken);

    const { username, password, nickname } = req.body;
    if (!username || !password) return res.status(400).json({ error: '用户名和密码必填' });
    if (username.length < 2 || username.length > 20) return res.status(400).json({ error: '用户名 2-20 字符' });
    if (password.length < 4) return res.status(400).json({ error: '密码至少 4 位' });

    const clientIp = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.ip;
    const ipExists = db.prepare('SELECT id FROM users WHERE register_ip = ?').get(clientIp);
    if (ipExists) return res.status(403).json({ error: '该网络已注册过账号' });

    const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
    if (existing) return res.status(409).json({ error: '用户名已存在' });

    const hash = await bcrypt.hash(password, 10);
    const token = crypto.randomBytes(32).toString('hex');
    const displayName = (nickname || '').trim() || username;

    const result = db.prepare('INSERT INTO users (username, password_hash, nickname, register_ip) VALUES (?, ?, ?, ?)').run(username, hash, displayName, clientIp);
    const regTokenHash = crypto.createHash('sha256').update(token).digest('hex');
    db.prepare('INSERT INTO sessions (user_id, token_hash) VALUES (?, ?)').run(result.lastInsertRowid, regTokenHash);
    db.prepare("UPDATE invite_codes SET used_by = ?, used_at = datetime('now', 'localtime') WHERE code = ? AND created_date = ? AND used_by IS NULL")
      .run(result.lastInsertRowid, inviteCode.trim().toUpperCase(), today);
    const user = db.prepare('SELECT id, username, nickname, avatar, role FROM users WHERE id = ?').get(result.lastInsertRowid);

    res.status(201).json({ ...user, token });
  });

  app.post('/api/login', async (req, res) => {
    const loginIp = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.ip;
    if (rateLimit('login:' + loginIp, 10, 60000)) return res.status(429).json({ error: '登录尝试过于频繁，请稍后再试' });
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ error: '用户名和密码必填' });

    const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
    if (!user || !await bcrypt.compare(password, user.password_hash)) {
      return res.status(403).json({ error: '用户名或密码错误' });
    }

    const token = crypto.randomBytes(32).toString('hex');
    const loginTokenHash = crypto.createHash('sha256').update(token).digest('hex');
    db.prepare('INSERT INTO sessions (user_id, token_hash) VALUES (?, ?)').run(user.id, loginTokenHash);

    res.json({ id: user.id, username: user.username, nickname: user.nickname, avatar: user.avatar, role: user.role, token });
  });
}

module.exports = { registerAuthRoutes };
