function registerSocialRoutes({
  app,
  db,
  upload,
  generateThumbnail,
  getUser,
  requireLogin,
  requireAdmin,
  publicDir,
  path,
  fs,
}) {
  app.get('/api/posts', (req, res) => {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit) || 10));
    const offset = (page - 1) * limit;
    const startDate = req.query.start || null;
    const endDate = req.query.end || null;

    let where = '';
    const params = [];
    if (startDate && endDate) {
      where = "WHERE p.created_at >= ? AND p.created_at < datetime(?, '+1 day')";
      params.push(startDate, endDate);
    } else if (startDate) {
      where = 'WHERE p.created_at >= ?';
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

    const user = getUser(req);
    if (user) {
      posts.forEach((post) => {
        post.liked = !!db.prepare('SELECT 1 FROM likes WHERE post_id = ? AND user_id = ?').get(post.id, user.id);
      });
    }

    res.json({ posts, pagination: { page, limit, total, pages: Math.ceil(total / limit) } });
  });

  app.get('/api/posts/:id', (req, res) => {
    const id = parseInt(req.params.id);
    const post = db.prepare(`
      SELECT p.*, u.nickname as author_name, u.avatar as author_avatar,
      (SELECT COUNT(*) FROM likes WHERE post_id = p.id) as like_count,
      (SELECT COUNT(*) FROM comments WHERE post_id = p.id) as comment_count
      FROM posts p LEFT JOIN users u ON p.user_id = u.id WHERE p.id = ?
    `).get(id);
    if (!post) return res.status(404).json({ error: '动态不存在' });

    const user = getUser(req);
    if (user) {
      post.liked = !!db.prepare('SELECT 1 FROM likes WHERE post_id = ? AND user_id = ?').get(post.id, user.id);
    }
    res.json(post);
  });

  app.post('/api/posts/:id/view', (req, res) => {
    const id = parseInt(req.params.id);
    db.prepare('UPDATE posts SET views = views + 1 WHERE id = ?').run(id);
    const post = db.prepare('SELECT views FROM posts WHERE id = ?').get(id);
    res.json({ views: post ? post.views : 0 });
  });

  app.post('/api/posts', requireAdmin, upload.array('images', 9), async (req, res) => {
    try {
      const content = (req.body.content || '').trim() || null;
      const files = req.files || [];
      if (!content && !files.length) return res.status(400).json({ error: '内容和图片至少需要一个' });

      const imageList = files.map((f) => `/uploads/${f.filename}`);
      const thumbList = [];
      for (const f of files) {
        const t = await generateThumbnail(f.path);
        thumbList.push(t || `/uploads/${f.filename}`);
      }

      const image = imageList[0] || null;
      const thumbnail = thumbList[0] || null;
      const images = imageList.length ? JSON.stringify(imageList) : null;
      const thumbnails = thumbList.length ? JSON.stringify(thumbList) : null;

      const result = db.prepare("INSERT INTO posts (content, image, thumbnail, images, thumbnails, user_id, created_at) VALUES (?, ?, ?, ?, ?, ?, datetime('now', 'localtime'))")
        .run(content, image, thumbnail, images, thumbnails, req.user.id);
      const post = db.prepare(`
        SELECT p.*, u.nickname as author_name, u.avatar as author_avatar, 0 as like_count
        FROM posts p LEFT JOIN users u ON p.user_id = u.id WHERE p.id = ?
      `).get(result.lastInsertRowid);

      res.status(201).json(post);
    } catch (e) {
      console.error('发帖失败:', e.message);
      res.status(500).json({ error: '发帖失败' });
    }
  });

  app.delete('/api/posts/:id', requireAdmin, (req, res) => {
    const id = parseInt(req.params.id);
    const post = db.prepare('SELECT * FROM posts WHERE id = ?').get(id);
    if (!post) return res.status(404).json({ error: '动态不存在' });

    if (post.image) fs.unlink(path.join(publicDir, post.image), () => {});
    if (post.thumbnail) fs.unlink(path.join(publicDir, post.thumbnail), () => {});

    db.prepare('DELETE FROM likes WHERE post_id = ?').run(id);
    db.prepare('DELETE FROM posts WHERE id = ?').run(id);
    res.json({ message: '已删除' });
  });

  app.post('/api/posts/:id/like', requireLogin, (req, res) => {
    const postId = parseInt(req.params.id);
    const post = db.prepare('SELECT id, user_id FROM posts WHERE id = ?').get(postId);
    if (!post) return res.status(404).json({ error: '动态不存在' });

    const toggleLike = db.transaction(() => {
      const existing = db.prepare('SELECT id FROM likes WHERE post_id = ? AND user_id = ?').get(postId, req.user.id);
      if (existing) {
        db.prepare('DELETE FROM likes WHERE post_id = ? AND user_id = ?').run(postId, req.user.id);
      } else {
        db.prepare('INSERT OR IGNORE INTO likes (post_id, user_id) VALUES (?, ?)').run(postId, req.user.id);
        if (post.user_id && post.user_id !== req.user.id) {
          db.prepare("INSERT INTO notifications (user_id, type, from_user_id, post_id) VALUES (?, 'like', ?, ?)").run(post.user_id, req.user.id, postId);
        }
      }
      const count = db.prepare('SELECT COUNT(*) as count FROM likes WHERE post_id = ?').get(postId).count;
      return { liked: !existing, count };
    });

    res.json(toggleLike());
  });

  app.get('/api/posts/:id/comments', (req, res) => {
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

  app.post('/api/posts/:id/comments', requireLogin, (req, res) => {
    const postId = parseInt(req.params.id);
    const { content } = req.body;
    if (!content || !content.trim()) return res.status(400).json({ error: '评论内容不能为空' });
    if (content.length > 500) return res.status(400).json({ error: '评论不能超过 500 字' });

    const post = db.prepare('SELECT id, user_id FROM posts WHERE id = ?').get(postId);
    if (!post) return res.status(404).json({ error: '动态不存在' });

    const parentId = req.body.parent_id ? parseInt(req.body.parent_id) : null;
    let replyToUserId = null;

    if (parentId) {
      const parentComment = db.prepare('SELECT * FROM comments WHERE id = ? AND post_id = ?').get(parentId, postId);
      if (!parentComment) return res.status(400).json({ error: '回复的评论不存在' });
      replyToUserId = parentComment.user_id;
    }

    const result = db.prepare('INSERT INTO comments (post_id, user_id, content, parent_id, reply_to_user_id) VALUES (?, ?, ?, ?, ?)')
      .run(postId, req.user.id, content.trim(), parentId, replyToUserId);

    if (replyToUserId && replyToUserId !== req.user.id) {
      db.prepare("INSERT INTO notifications (user_id, type, from_user_id, post_id, comment_id, content) VALUES (?, 'reply', ?, ?, ?, ?)")
        .run(replyToUserId, req.user.id, postId, result.lastInsertRowid, content.trim().slice(0, 100));
    }
    if (post.user_id && post.user_id !== req.user.id && post.user_id !== replyToUserId) {
      db.prepare("INSERT INTO notifications (user_id, type, from_user_id, post_id, comment_id, content) VALUES (?, 'comment', ?, ?, ?, ?)")
        .run(post.user_id, req.user.id, postId, result.lastInsertRowid, content.trim().slice(0, 100));
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

  app.delete('/api/comments/:id', requireLogin, (req, res) => {
    const commentId = parseInt(req.params.id);
    const comment = db.prepare('SELECT * FROM comments WHERE id = ?').get(commentId);
    if (!comment) return res.status(404).json({ error: '评论不存在' });
    if (comment.user_id !== req.user.id && req.user.role !== 'superadmin' && req.user.role !== 'admin') {
      return res.status(403).json({ error: '无权删除' });
    }
    const childIds = db.prepare('SELECT id FROM comments WHERE parent_id = ?').all(commentId).map((r) => r.id);
    for (const cid of childIds) {
      db.prepare('DELETE FROM notifications WHERE comment_id = ?').run(cid);
    }
    db.prepare('DELETE FROM comments WHERE parent_id = ?').run(commentId);
    db.prepare('DELETE FROM notifications WHERE comment_id = ?').run(commentId);
    db.prepare('DELETE FROM comments WHERE id = ?').run(commentId);
    res.json({ ok: true });
  });

  app.get('/api/notifications', requireLogin, (req, res) => {
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

  app.get('/api/notifications/unread-count', requireLogin, (req, res) => {
    const row = db.prepare('SELECT COUNT(*) as count FROM notifications WHERE user_id = ? AND is_read = 0').get(req.user.id);
    res.json({ count: row.count });
  });

  app.post('/api/notifications/read-all', requireLogin, (req, res) => {
    db.prepare('UPDATE notifications SET is_read = 1 WHERE user_id = ? AND is_read = 0').run(req.user.id);
    res.json({ ok: true });
  });

  app.post('/api/notifications/:id/read', requireLogin, (req, res) => {
    const id = parseInt(req.params.id);
    db.prepare('UPDATE notifications SET is_read = 1 WHERE id = ? AND user_id = ?').run(id, req.user.id);
    res.json({ ok: true });
  });
}

module.exports = { registerSocialRoutes };
