const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');

function initDatabase(config) {
  const db = new Database(config.dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

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

  db.exec(`
    CREATE TABLE IF NOT EXISTS posts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      content TEXT,
      image TEXT,
      images TEXT,
      thumbnails TEXT,
      user_id INTEGER,
      views INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id)
    )
  `);

  db.exec(`CREATE TABLE IF NOT EXISTS visitors (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    ip TEXT,
    user_agent TEXT,
    visited_at DATETIME DEFAULT (datetime('now','localtime')),
    FOREIGN KEY (user_id) REFERENCES users(id)
  )`);

  try { db.exec('ALTER TABLE posts ADD COLUMN images TEXT'); } catch (e) {}
  try { db.exec('ALTER TABLE posts ADD COLUMN thumbnails TEXT'); } catch (e) {}

  db.exec(`
    CREATE TABLE IF NOT EXISTS likes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      post_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(post_id, user_id),
      FOREIGN KEY (post_id) REFERENCES posts(id),
      FOREIGN KEY (user_id) REFERENCES users(id)
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      token_hash TEXT UNIQUE NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `);

  db.exec(`CREATE TABLE IF NOT EXISTS invite_codes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    code TEXT UNIQUE NOT NULL,
    created_date TEXT NOT NULL,
    used_by INTEGER,
    used_at DATETIME,
    FOREIGN KEY (used_by) REFERENCES users(id)
  )`);

  db.exec(`CREATE TABLE IF NOT EXISTS announcements (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    title TEXT NOT NULL,
    content TEXT NOT NULL,
    pinned INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT (datetime('now', 'localtime')),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  )`);

  db.exec(`CREATE TABLE IF NOT EXISTS comments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    post_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    content TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  )`);

  db.exec(`CREATE TABLE IF NOT EXISTS notifications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    type TEXT NOT NULL,
    from_user_id INTEGER,
    post_id INTEGER,
    comment_id INTEGER,
    content TEXT,
    is_read INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (from_user_id) REFERENCES users(id) ON DELETE SET NULL,
    FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE
  )`);

  db.exec(`CREATE TABLE IF NOT EXISTS password_reset_codes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    code TEXT UNIQUE NOT NULL,
    used INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  )`);

  db.exec(`CREATE TABLE IF NOT EXISTS articles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    category TEXT NOT NULL CHECK(category IN ('blog', 'chitchat')),
    title TEXT NOT NULL,
    content TEXT NOT NULL,
    summary TEXT,
    cover_image TEXT,
    user_id INTEGER NOT NULL,
    views INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT (datetime('now', 'localtime')),
    updated_at DATETIME DEFAULT (datetime('now', 'localtime')),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  )`);

  try { db.exec('ALTER TABLE posts ADD COLUMN user_id INTEGER'); } catch (e) {}
  try { db.exec('ALTER TABLE posts ADD COLUMN thumbnail TEXT'); } catch (e) {}
  try { db.exec('ALTER TABLE users ADD COLUMN register_ip TEXT'); } catch (e) {}

  function generateDailyInviteCode() {
    const today = new Date().toISOString().slice(0, 10);
    const existing = db.prepare('SELECT id FROM invite_codes WHERE created_date = ? AND used_by IS NULL').get(today);
    if (!existing) {
      const code = crypto.randomBytes(4).toString('hex').toUpperCase();
      db.prepare('INSERT INTO invite_codes (code, created_date) VALUES (?, ?)').run(code, today);
      console.log('📨 今日邀请码已生成: ' + code);
    }
  }

  generateDailyInviteCode();
  setInterval(generateDailyInviteCode, 3600000);

  const superAdmin = db.prepare("SELECT id FROM users WHERE role = 'superadmin'").get();
  if (!superAdmin) {
    const adminPwd = process.env.ADMIN_PASSWORD || 'admin123';
    const hash = bcrypt.hashSync(adminPwd, 10);
    db.prepare('INSERT INTO users (username, password_hash, nickname, role) VALUES (?, ?, ?, ?)').run('NaBr406', hash, 'NaBr406', 'superadmin');
    console.log('✅ 超级管理员已创建 (admin / admin123)');
  }

  return db;
}

module.exports = { initDatabase };
