// ========== 文章页通用 JS（Vditor 版） ==========
// 页面需设置 window.ARTICLE_CATEGORY = 'blog' | 'chitchat'
// 页面需引入 Vditor CDN

let currentUser = null;
let currentPage = 1;
let totalPages = 1;
let loading = false;
let currentView = 'list';
let vditorInstance = null;

document.addEventListener("DOMContentLoaded", async () => {
  const token = localStorage.getItem("token");
  if (token) {
    try {
      const res = await fetch("/api/me", { headers: { "Authorization": "Bearer " + token } });
      if (res.ok) {
        currentUser = await res.json();
        currentUser.token = token;
      } else { localStorage.removeItem("token"); }
    } catch {}
  }
  updateUI();
  const cat = window.ARTICLE_CATEGORY;
  const pathMatch = window.location.pathname.match(new RegExp(`^/(space/)?${cat}/(\\d+)$`));
  if (pathMatch) { showArticleDetail(parseInt(pathMatch[2])); }
  else { loadArticles(); }
});

function updateUI() {
  const loginArea = document.getElementById("loginArea");
  const userArea = document.getElementById("userArea");
  const publishBtn = document.getElementById("publishArticleBtn");
  if (currentUser) {
    if (loginArea) loginArea.style.display = "none";
    if (userArea) {
      userArea.style.display = "flex";
      document.getElementById("userAvatar").src = currentUser.avatar || "/default-avatar.png";
      document.getElementById("userNickname").textContent = currentUser.nickname;
    }
    if (publishBtn) publishBtn.style.display = currentUser.role === "superadmin" ? "" : "none";
  } else {
    if (loginArea) loginArea.style.display = "flex";
    if (userArea) userArea.style.display = "none";
    if (publishBtn) publishBtn.style.display = "none";
  }
}

// ========== 初始化 Vditor 编辑器 ==========
function initVditor(elementId, initialValue) {
  if (vditorInstance) { vditorInstance.destroy(); vditorInstance = null; }
  vditorInstance = new Vditor(elementId, {
    height: 400,
    mode: 'ir',
    placeholder: '写点什么...',
    value: initialValue || '',
    theme: window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'classic',
    toolbar: [
      'headings', 'bold', 'italic', 'strike', '|',
      'list', 'ordered-list', 'check', '|',
      'quote', 'code', 'inline-code', '|',
      'link', 'upload', 'table', '|',
      'undo', 'redo', '|',
      'fullscreen', 'preview'
    ],
    upload: {
      url: '/api/upload-image',
      fieldName: 'image',
      max: 10 * 1024 * 1024,
      accept: 'image/*',
      headers: { "Authorization": "Bearer " + (currentUser ? currentUser.token : '') },
      format: (files, responseText) => { return responseText; },
      error: () => { showToast('图片上传失败'); }
    },
    cache: { enable: false },
    after: () => {}
  });
}

// ========== 文章列表 ==========
async function loadArticles() {
  if (loading) return;
  loading = true;
  const container = document.getElementById("articleContainer");
  const cat = window.ARTICLE_CATEGORY;
  try {
    const res = await fetch(`/api/articles?category=${cat}&page=${currentPage}&limit=10`);
    const data = await res.json();
    if (currentPage === 1) container.innerHTML = "";
    if (data.articles.length === 0 && currentPage === 1) {
      const catName = cat === 'blog' ? '博客' : '杂谈';
      container.innerHTML = `<div class="article-empty"><svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block;vertical-align:-2px"><path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M10 9H8"/><path d="M16 13H8"/><path d="M16 17H8"/></svg> 还没有${catName}文章</div>`;
      document.getElementById("loadMoreBtn").style.display = "none";
    } else {
      data.articles.forEach(a => container.appendChild(createArticleCard(a)));
      totalPages = data.pagination.pages;
      document.getElementById("loadMoreBtn").style.display = currentPage < totalPages ? "block" : "none";
      currentPage++;
    }
  } catch (err) { showToast("加载失败: " + err.message); }
  finally { loading = false; }
}

function createArticleCard(a) {
  const card = document.createElement("div");
  card.className = "article-card";
  card.onclick = () => showArticleDetail(a.id);
  let coverHtml = a.cover_image ? `<img src="${escapeHtml(a.cover_image)}" class="article-card-cover" loading="lazy">` : "";
  let summaryText = a.summary || (a.content ? a.content.replace(/[#*`>\-\[\]!()]/g, '').slice(0, 150) : "");
  card.innerHTML = `
    ${coverHtml}
    <div class="article-card-title">${escapeHtml(a.title)}</div>
    <div class="article-card-summary">${escapeHtml(summaryText)}</div>
    <div class="article-card-meta">
      <span>${escapeHtml(a.author_name || '管理员')}</span>
      <span>${formatTime(a.created_at)}</span>
      <span>👁 ${a.views || 0}</span>
    </div>
  `;
  return card;
}

// ========== 文章详情（Markdown 渲染） ==========
async function showArticleDetail(id) {
  currentView = 'detail';
  if (vditorInstance) { vditorInstance.destroy(); vditorInstance = null; }
  const container = document.getElementById("articleContainer");
  document.getElementById("loadMoreBtn").style.display = "none";
  container.innerHTML = '<div style="text-align:center;padding:60px;color:var(--text-secondary)">加载中...</div>';
  fetch(`/api/articles/${id}/view`, { method: "POST" }).catch(() => {});
  try {
    const res = await fetch(`/api/articles/${id}`);
    if (!res.ok) throw new Error("文章不存在");
    const a = await res.json();
    let deleteBtn = "", editBtn = "";
    if (currentUser && currentUser.role === "superadmin") {
      deleteBtn = `<button class="btn btn-danger btn-sm" onclick="deleteArticle(${a.id})" style="margin-left:8px">删除</button>`;
      editBtn = `<button class="btn btn-secondary btn-sm" onclick="showEditForm(${a.id})" style="margin-left:8px">编辑</button>`;
    }
    let coverHtml = a.cover_image ? `<img src="${escapeHtml(a.cover_image)}" style="width:100%;max-height:300px;object-fit:cover;border-radius:8px;margin-bottom:20px">` : "";
    container.innerHTML = `
      <div class="article-detail">
        <a href="javascript:void(0)" onclick="backToList()" class="back-link" style="display:inline-block;margin-bottom:16px;color:var(--primary);text-decoration:none">← 返回列表</a>
        ${coverHtml}
        <h1 class="article-detail-title">${escapeHtml(a.title)}</h1>
        <div class="article-detail-meta">
          <span>${escapeHtml(a.author_name || '管理员')}</span>
          <span>${formatTime(a.created_at)}</span>
          <span>👁 ${a.views || 0}</span>
          ${editBtn}${deleteBtn}
        </div>
        <div class="article-detail-content" id="articlePreview"></div>
      </div>
    `;
    // 用 Vditor 渲染 Markdown
    const previewEl = document.getElementById("articlePreview");
    if (typeof Vditor !== 'undefined' && Vditor.preview) {
      Vditor.preview(previewEl, a.content, {
        theme: { current: window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light' },
        hljs: { lineNumber: true }
      });
    } else {
      previewEl.innerHTML = escapeHtml(a.content).replace(/\n/g, '<br>');
    }
    const cat = window.ARTICLE_CATEGORY;
    history.pushState({ detail: id }, "", `/${cat}/${id}`);
    document.title = a.title + (cat === 'blog' ? ' - 博客' : ' - 杂谈');
  } catch (err) {
    container.innerHTML = `<div style="text-align:center;padding:60px;color:#ef4444">${err.message}</div>`;
  }
}

function backToList() {
  currentView = 'list'; currentPage = 1;
  if (vditorInstance) { vditorInstance.destroy(); vditorInstance = null; }
  document.getElementById("articleContainer").innerHTML = "";
  loadArticles();
  const cat = window.ARTICLE_CATEGORY;
  history.replaceState(null, "", `/${cat}`);
  document.title = cat === 'blog' ? '博客' : '杂谈';
}

window.addEventListener("popstate", () => {
  const cat = window.ARTICLE_CATEGORY;
  const m = window.location.pathname.match(new RegExp(`^/(space/)?${cat}/(\\d+)$`));
  if (m) { showArticleDetail(parseInt(m[2])); } else { backToList(); }
});

// ========== 发布文章（Vditor） ==========
function showPublishForm() {
  currentView = 'publish';
  const container = document.getElementById("articleContainer");
  document.getElementById("loadMoreBtn").style.display = "none";
  const cat = window.ARTICLE_CATEGORY;
  const catName = cat === 'blog' ? '博客' : '杂谈';
  container.innerHTML = `
    <div class="article-form">
      <a href="javascript:void(0)" onclick="backToList()" class="back-link" style="display:inline-block;margin-bottom:16px;color:var(--primary);text-decoration:none">← 返回列表</a>
      <h2 style="margin-bottom:16px">发布${catName}</h2>
      <input type="text" id="articleTitle" placeholder="标题" maxlength="200">
      <input type="text" id="articleSummary" placeholder="摘要（选填，不填自动截取）" maxlength="300">
      <div style="margin-bottom:12px">
        <label style="display:inline-flex;align-items:center;gap:4px;cursor:pointer;color:var(--primary);font-size:0.9rem">
          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block;vertical-align:-2px"><rect width="18" height="18" x="3" y="3" rx="2" ry="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/></svg> 封面图（选填）
          <input type="file" id="articleCover" accept="image/*" hidden onchange="previewCover(this)">
        </label>
        <div id="coverPreview"></div>
      </div>
      <div id="vditorEditor"></div>
      <div class="article-form-actions" style="margin-top:12px">
        <button class="btn btn-secondary" onclick="backToList()">取消</button>
        <button class="btn btn-primary" onclick="submitArticle()">发布</button>
      </div>
    </div>
  `;
  initVditor('vditorEditor', '');
}

function previewCover(input) {
  const preview = document.getElementById("coverPreview");
  if (input.files && input.files[0]) {
    const reader = new FileReader();
    reader.onload = (e) => {
      preview.innerHTML = `<img src="${e.target.result}" style="max-width:100%;max-height:150px;border-radius:8px;margin-top:8px"><button onclick="clearCover()" style="margin-left:8px" class="btn btn-secondary btn-sm">移除</button>`;
    };
    reader.readAsDataURL(input.files[0]);
  }
}
function clearCover() {
  document.getElementById("articleCover").value = "";
  document.getElementById("coverPreview").innerHTML = "";
}

async function submitArticle() {
  const title = document.getElementById("articleTitle").value.trim();
  const content = vditorInstance ? vditorInstance.getValue().trim() : '';
  const summary = document.getElementById("articleSummary").value.trim();
  const coverInput = document.getElementById("articleCover");
  if (!title) return showToast("请输入标题");
  if (!content) return showToast("请输入内容");
  const formData = new FormData();
  formData.append("title", title);
  formData.append("content", content);
  formData.append("category", window.ARTICLE_CATEGORY);
  if (summary) formData.append("summary", summary);
  if (coverInput.files && coverInput.files[0]) formData.append("cover", coverInput.files[0]);
  try {
    const res = await fetch("/api/articles", {
      method: "POST",
      headers: { "Authorization": "Bearer " + currentUser.token },
      body: formData
    });
    if (!res.ok) { const err = await res.json(); throw new Error(err.error); }
    showToast("发布成功");
    backToList();
  } catch (err) { showToast(err.message); }
}

// ========== 编辑文章（Vditor） ==========
async function showEditForm(id) {
  currentView = 'edit';
  const container = document.getElementById("articleContainer");
  document.getElementById("loadMoreBtn").style.display = "none";
  try {
    const res = await fetch(`/api/articles/${id}`);
    const a = await res.json();
    container.innerHTML = `
      <div class="article-form">
        <a href="javascript:void(0)" onclick="showArticleDetail(${id})" class="back-link" style="display:inline-block;margin-bottom:16px;color:var(--primary);text-decoration:none">← 返回文章</a>
        <h2 style="margin-bottom:16px">编辑文章</h2>
        <input type="text" id="editTitle" placeholder="标题" maxlength="200" value="${escapeAttr(a.title)}">
        <input type="text" id="editSummary" placeholder="摘要（选填）" maxlength="300" value="${escapeAttr(a.summary || '')}">
        <div style="margin-bottom:12px">
          <label style="display:inline-flex;align-items:center;gap:4px;cursor:pointer;color:var(--primary);font-size:0.9rem">
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block;vertical-align:-2px"><rect width="18" height="18" x="3" y="3" rx="2" ry="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/></svg> 更换封面图
            <input type="file" id="editCover" accept="image/*" hidden onchange="previewEditCover(this)">
          </label>
          <div id="editCoverPreview">${a.cover_image ? `<img src="${escapeHtml(a.cover_image)}" style="max-width:100%;max-height:150px;border-radius:8px;margin-top:8px">` : ''}</div>
        </div>
        <div id="vditorEditor"></div>
        <div class="article-form-actions" style="margin-top:12px">
          <button class="btn btn-secondary" onclick="showArticleDetail(${id})">取消</button>
          <button class="btn btn-primary" onclick="updateArticle(${id})">保存</button>
        </div>
      </div>
    `;
    initVditor('vditorEditor', a.content || '');
  } catch (err) { showToast("加载失败"); }
}

function previewEditCover(input) {
  const preview = document.getElementById("editCoverPreview");
  if (input.files && input.files[0]) {
    const reader = new FileReader();
    reader.onload = (e) => {
      preview.innerHTML = `<img src="${e.target.result}" style="max-width:100%;max-height:150px;border-radius:8px;margin-top:8px">`;
    };
    reader.readAsDataURL(input.files[0]);
  }
}

async function updateArticle(id) {
  const title = document.getElementById("editTitle").value.trim();
  const content = vditorInstance ? vditorInstance.getValue().trim() : '';
  const summary = document.getElementById("editSummary").value.trim();
  const coverInput = document.getElementById("editCover");
  if (!title) return showToast("请输入标题");
  if (!content) return showToast("请输入内容");
  const formData = new FormData();
  formData.append("title", title);
  formData.append("content", content);
  if (summary) formData.append("summary", summary);
  if (coverInput.files && coverInput.files[0]) formData.append("cover", coverInput.files[0]);
  try {
    const res = await fetch(`/api/articles/${id}`, {
      method: "PUT",
      headers: { "Authorization": "Bearer " + currentUser.token },
      body: formData
    });
    if (!res.ok) { const err = await res.json(); throw new Error(err.error); }
    showToast("已保存");
    showArticleDetail(id);
  } catch (err) { showToast(err.message); }
}

// ========== 删除文章 ==========
async function deleteArticle(id) {
  if (!confirm("确定要删除这篇文章吗？")) return;
  try {
    const res = await fetch(`/api/articles/${id}`, {
      method: "DELETE",
      headers: { "Authorization": "Bearer " + currentUser.token }
    });
    if (!res.ok) { const err = await res.json(); throw new Error(err.error); }
    showToast("已删除");
    backToList();
  } catch (err) { showToast(err.message); }
}

// ========== 工具函数 ==========
function escapeHtml(t) { if (!t) return ''; const d = document.createElement("div"); d.textContent = t; return d.innerHTML; }
function escapeAttr(t) { if (!t) return ''; return t.replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/'/g,'&#39;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
function formatTime(dateStr) {
  const date = new Date(dateStr), now = new Date(), diff = (now - date) / 1000;
  if (diff < 60) return "刚刚";
  if (diff < 3600) return Math.floor(diff / 60) + " 分钟前";
  if (diff < 86400) return Math.floor(diff / 3600) + " 小时前";
  if (diff < 604800) return Math.floor(diff / 86400) + " 天前";
  const y = date.getFullYear(), m = String(date.getMonth()+1).padStart(2,"0"), d = String(date.getDate()).padStart(2,"0"), h = String(date.getHours()).padStart(2,"0"), min = String(date.getMinutes()).padStart(2,"0");
  return y === now.getFullYear() ? `${m}-${d} ${h}:${min}` : `${y}-${m}-${d} ${h}:${min}`;
}
function showToast(msg) { const t = document.getElementById("toast"); t.textContent = msg; t.classList.add("show"); setTimeout(() => t.classList.remove("show"), 2500); }
function goLogin() { window.location.href = "/space/#login"; }
function doLogout() {
  const token = localStorage.getItem("token");
  if (token) fetch("/api/logout", { method: "POST", headers: { "Authorization": "Bearer " + token } }).catch(() => {});
  currentUser = null; localStorage.removeItem("token"); updateUI(); showToast("已退出");
}
