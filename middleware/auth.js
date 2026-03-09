const crypto = require('crypto');

function createAuthMiddleware(db) {
  function getUser(req) {
    const token = req.headers['authorization']?.replace('Bearer ', '');
    if (!token) return null;
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    return db
      .prepare(
        'SELECT u.id, u.username, u.nickname, u.avatar, u.role FROM users u JOIN sessions s ON u.id = s.user_id WHERE s.token_hash = ?'
      )
      .get(tokenHash) || null;
  }

  function requireLogin(req, res, next) {
    const user = getUser(req);
    if (!user) {
      res.set('Cache-Control', 'no-store, no-cache, must-revalidate');
      res.set('Pragma', 'no-cache');
      res.set('Expires', '0');
      return res.status(401).json({ error: '请先登录' });
    }
    req.user = user;
    next();
  }

  function requireAdmin(req, res, next) {
    const user = getUser(req);
    if (!user) return res.status(401).json({ error: '请先登录' });
    if (user.role !== 'admin' && user.role !== 'superadmin') {
      return res.status(403).json({ error: '需要管理员权限' });
    }
    req.user = user;
    next();
  }

  function requireSuperAdmin(req, res, next) {
    const user = getUser(req);
    if (!user) return res.status(401).json({ error: '请先登录' });
    if (user.role !== 'superadmin') {
      return res.status(403).json({ error: '需要超级管理员权限' });
    }
    req.user = user;
    next();
  }

  return {
    getUser,
    requireLogin,
    requireAdmin,
    requireSuperAdmin,
  };
}

module.exports = { createAuthMiddleware };
