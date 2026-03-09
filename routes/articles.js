function registerArticleRoutes({ app, db, upload, requireSuperAdmin, publicDir, path, fs }) {
  app.get('/api/articles', (req, res) => {
    const category = req.query.category;
    if (!category || !['blog', 'chitchat'].includes(category)) {
      return res.status(400).json({ error: 'category 必须是 blog 或 chitchat' });
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

    const total = db.prepare('SELECT COUNT(*) as count FROM articles WHERE category = ?').get(category).count;
    res.json({ articles, pagination: { page, limit, total, pages: Math.ceil(total / limit) } });
  });

  app.get('/api/articles/:id', (req, res) => {
    const article = db.prepare(`
      SELECT a.*, u.nickname as author_name, u.avatar as author_avatar
      FROM articles a LEFT JOIN users u ON a.user_id = u.id
      WHERE a.id = ?
    `).get(parseInt(req.params.id));
    if (!article) return res.status(404).json({ error: '文章不存在' });
    res.json(article);
  });

  app.post('/api/articles/:id/view', (req, res) => {
    const id = parseInt(req.params.id);
    db.prepare('UPDATE articles SET views = views + 1 WHERE id = ?').run(id);
    const article = db.prepare('SELECT views FROM articles WHERE id = ?').get(id);
    res.json({ views: article ? article.views : 0 });
  });

  app.post('/api/articles', requireSuperAdmin, upload.single('cover'), (req, res) => {
    const { title, content, summary, category } = req.body;
    if (!title || !title.trim()) return res.status(400).json({ error: '标题不能为空' });
    if (!content || !content.trim()) return res.status(400).json({ error: '内容不能为空' });
    if (!category || !['blog', 'chitchat'].includes(category)) return res.status(400).json({ error: '分类无效' });

    const coverImage = req.file ? '/uploads/' + req.file.filename : null;
    const result = db.prepare(
      'INSERT INTO articles (category, title, content, summary, cover_image, user_id) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(category, title.trim(), content.trim(), (summary || '').trim() || null, coverImage, req.user.id);

    const article = db.prepare('SELECT * FROM articles WHERE id = ?').get(result.lastInsertRowid);
    res.status(201).json(article);
  });

  app.put('/api/articles/:id', requireSuperAdmin, upload.single('cover'), (req, res) => {
    const id = parseInt(req.params.id);
    const existing = db.prepare('SELECT * FROM articles WHERE id = ?').get(id);
    if (!existing) return res.status(404).json({ error: '文章不存在' });

    const { title, content, summary } = req.body;
    if (!title || !title.trim()) return res.status(400).json({ error: '标题不能为空' });
    if (!content || !content.trim()) return res.status(400).json({ error: '内容不能为空' });

    const coverImage = req.file ? '/uploads/' + req.file.filename : existing.cover_image;
    db.prepare(
      "UPDATE articles SET title = ?, content = ?, summary = ?, cover_image = ?, updated_at = datetime('now', 'localtime') WHERE id = ?"
    ).run(title.trim(), content.trim(), (summary || '').trim() || null, coverImage, id);

    const article = db.prepare('SELECT * FROM articles WHERE id = ?').get(id);
    res.json(article);
  });

  app.delete('/api/articles/:id', requireSuperAdmin, (req, res) => {
    const id = parseInt(req.params.id);
    const article = db.prepare('SELECT * FROM articles WHERE id = ?').get(id);
    if (!article) return res.status(404).json({ error: '文章不存在' });
    if (article.cover_image) {
      const coverPath = path.join(publicDir, article.cover_image);
      fs.unlink(coverPath, () => {});
    }
    db.prepare('DELETE FROM articles WHERE id = ?').run(id);
    res.json({ ok: true });
  });

  app.get('/blog', (req, res) => {
    res.sendFile(path.join(publicDir, 'blog.html'));
  });
  app.get('/blog/:id', (req, res) => {
    res.sendFile(path.join(publicDir, 'blog.html'));
  });

  app.get('/chitchat', (req, res) => {
    res.sendFile(path.join(publicDir, 'chitchat.html'));
  });
  app.get('/chitchat/:id', (req, res) => {
    res.sendFile(path.join(publicDir, 'chitchat.html'));
  });
}

module.exports = { registerArticleRoutes };
