// ========== 文章页通用 JS（博客用 Vditor，杂谈用简洁模式） ==========
// 页面需设置 window.ARTICLE_CATEGORY = 'blog' | 'chitchat'

let currentUser = null;
let currentPage = 1;
let totalPages = 1;
let loading = false;
let currentView = 'list';
let vditorInstance = null;
let editorState = null;
let editorShortcutHandler = null;

const EDITOR_DRAFT_PREFIX = 'article_draft_v2';
const isBlog = () => window.ARTICLE_CATEGORY === 'blog';

(function syncMainSiteToken() {
  try {
    const currentToken = localStorage.getItem("token");
    const psMainToken = localStorage.getItem("ps_main_token");
    if (currentToken && !currentToken.startsWith("eyJ")) {
      localStorage.setItem("ps_main_token", currentToken);
    }
    if (psMainToken && (!currentToken || currentToken.startsWith("eyJ"))) {
      localStorage.setItem("token", psMainToken);
    }
  } catch (e) {}
})();

document.addEventListener("DOMContentLoaded", async () => {
  const token = localStorage.getItem("ps_main_token") || localStorage.getItem("token");
  if (token) {
    try {
      const res = await fetch("/api/me", { headers: { "Authorization": "Bearer " + token } });
      if (res.ok) { currentUser = await res.json(); currentUser.token = token; }
      else { localStorage.removeItem("token"); localStorage.removeItem("ps_main_token"); }
    } catch {}
  }
  updateUI();
  const cat = window.ARTICLE_CATEGORY;
  const pathMatch = window.location.pathname.match(new RegExp(`^/(space/)?${cat}/(\\d+)$`));
  if (pathMatch) { showArticleDetail(parseInt(pathMatch[2], 10)); }
  else { loadArticles(); }
});

window.addEventListener('beforeunload', (event) => {
  if (!shouldBlockEditorLeave()) return;
  event.preventDefault();
  event.returnValue = '';
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

function getEditorHeight() {
  const safeHeight = window.innerHeight - 300;
  return Math.max(360, Math.min(safeHeight, 760));
}

function parseEditorUploadUrl(payload) {
  const succMap = payload && payload.data && payload.data.succMap ? payload.data.succMap : null;
  if (!succMap) return '';
  const urls = Object.values(succMap);
  return urls.length ? urls[0] : '';
}

async function uploadImageForEditor(file) {
  const formData = new FormData();
  formData.append('image', file);
  const res = await fetch('/api/upload-image', {
    method: 'POST',
    headers: { "Authorization": "Bearer " + (currentUser ? currentUser.token : '') },
    body: formData
  });
  if (!res.ok) throw new Error('图片上传失败');
  const payload = await res.json();
  const url = parseEditorUploadUrl(payload);
  if (!url) throw new Error('图片上传失败');
  return url;
}

function initVditor(elementId, initialValue, options = {}) {
  if (vditorInstance) { vditorInstance.destroy(); vditorInstance = null; }

  if (typeof toastui !== 'undefined' && toastui.Editor) {
    const target = document.getElementById(elementId);
    if (!target) throw new Error('编辑器容器不存在');
    target.innerHTML = '';

    const editor = new toastui.Editor({
      el: target,
      height: `${getEditorHeight()}px`,
      initialValue: initialValue || '',
      initialEditType: 'wysiwyg',
      previewStyle: 'vertical',
      placeholder: '写点什么...',
      language: 'zh-CN',
      theme: window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light',
      usageStatistics: false,
      toolbarItems: [
        ['heading', 'bold', 'italic', 'strike'],
        ['hr', 'quote'],
        ['ul', 'ol', 'task'],
        ['table', 'image', 'link'],
        ['code', 'codeblock']
      ],
      hooks: {
        addImageBlobHook: async (blob, callback) => {
          try {
            const imageUrl = await uploadImageForEditor(blob);
            callback(imageUrl, blob.name || 'image');
          } catch (err) {
            showToast(err.message || '图片上传失败');
          }
          return false;
        }
      }
    });

    vditorInstance = {
      getValue: () => editor.getMarkdown(),
      setValue: (value) => editor.setMarkdown(value || ''),
      destroy: () => editor.destroy(),
      focus: () => editor.focus()
    };

    if (typeof options.onInput === 'function') {
      editor.on('change', () => options.onInput(vditorInstance.getValue()));
    }
    if (typeof options.onReady === 'function') {
      setTimeout(() => options.onReady(), 0);
    }
    return;
  }

  if (typeof Vditor !== 'undefined') {
    vditorInstance = new Vditor(elementId, {
      height: getEditorHeight(),
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
        format: (files, responseText) => responseText,
        error: () => { showToast('图片上传失败'); }
      },
      cache: { enable: false },
      input: (value) => {
        if (typeof options.onInput === 'function') options.onInput(value);
      },
      after: () => {
        if (typeof options.onReady === 'function') options.onReady();
      }
    });
    return;
  }

  throw new Error('编辑器不可用');
}

function getDraftKey(mode, articleId) {
  return `${EDITOR_DRAFT_PREFIX}:${window.ARTICLE_CATEGORY}:${mode}:${articleId || 'new'}`;
}

function getBlogContentValue() {
  const plainEditor = document.getElementById('blogPlainContent');
  if (vditorInstance) return vditorInstance.getValue();
  return plainEditor ? plainEditor.value : '';
}

function setBlogContentValue(value) {
  const plainEditor = document.getElementById('blogPlainContent');
  if (vditorInstance) {
    vditorInstance.setValue(value || '');
    return;
  }
  if (plainEditor) plainEditor.value = value || '';
}

function getBlogEditorData(prefix) {
  const titleId = prefix === 'edit' ? 'editTitle' : 'articleTitle';
  const summaryId = prefix === 'edit' ? 'editSummary' : 'articleSummary';
  const titleEl = document.getElementById(titleId);
  const summaryEl = document.getElementById(summaryId);
  return {
    title: titleEl ? titleEl.value : '',
    summary: summaryEl ? summaryEl.value : '',
    content: getBlogContentValue()
  };
}

function getBlogEditorSnapshot(prefix) {
  const data = getBlogEditorData(prefix);
  return JSON.stringify({
    title: data.title.trim(),
    summary: data.summary.trim(),
    content: data.content.replace(/\s+$/g, '')
  });
}

function setEditorStatus(text, state = 'idle') {
  const status = document.getElementById('editorStatus');
  if (!status) return;
  status.textContent = text;
  status.dataset.state = state;
}

function setEditorDirtyFlag(dirty) {
  const dirtyEl = document.getElementById('editorDirtyFlag');
  if (!dirtyEl) return;
  dirtyEl.dataset.state = dirty ? 'dirty' : 'clean';
  dirtyEl.textContent = dirty ? '未保存更改' : '内容已同步';
}

function formatClock(ts) {
  const d = new Date(ts);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}

function updateEditorStats() {
  const rawContent = getBlogContentValue();
  const plainText = rawContent
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`[^`]*`/g, ' ')
    .replace(/[#>*~\-_[\]()!]/g, ' ')
    .replace(/\n+/g, ' ')
    .trim();

  const charCount = plainText.replace(/\s/g, '').length;
  const wordCount = plainText ? plainText.split(/\s+/).length : 0;
  const readingBase = charCount + wordCount;
  const readingMinutes = Math.max(1, Math.ceil(readingBase / 380));

  const wc = document.getElementById('editorWordCount');
  const rt = document.getElementById('editorReadTime');
  if (wc) wc.textContent = `${charCount} 字`;
  if (rt) rt.textContent = `预计阅读 ${readingMinutes} 分钟`;
}

function shouldBlockEditorLeave() {
  return isBlog() && editorState && editorState.dirty && !editorState.allowLeave;
}

function confirmLeaveEditor() {
  if (!shouldBlockEditorLeave()) return true;
  return confirm('你有未保存内容，确定离开吗？');
}

function clearEditorRuntime() {
  if (editorState && editorState.autosaveTimer) {
    clearTimeout(editorState.autosaveTimer);
  }
  if (editorShortcutHandler) {
    document.removeEventListener('keydown', editorShortcutHandler);
    editorShortcutHandler = null;
  }
  editorState = null;
}

function refreshEditorDirty(prefix) {
  if (!editorState) return;
  const currentSnapshot = getBlogEditorSnapshot(prefix);
  editorState.dirty = currentSnapshot !== editorState.initialSnapshot;
  setEditorDirtyFlag(editorState.dirty);
  if (editorState.dirty) {
    setEditorStatus('有未保存修改', 'dirty');
  } else if (currentSnapshot === editorState.lastSavedSnapshot) {
    setEditorStatus('草稿已同步', 'saved');
  } else {
    setEditorStatus('编辑器已就绪', 'idle');
  }
}

function saveBlogDraft(prefix, auto = true) {
  if (!editorState) return;
  const payload = {
    ...getBlogEditorData(prefix),
    updatedAt: Date.now()
  };
  localStorage.setItem(editorState.draftKey, JSON.stringify(payload));
  editorState.lastSavedSnapshot = getBlogEditorSnapshot(prefix);
  setEditorStatus(`${auto ? '已自动保存' : '已保存草稿'} ${formatClock(payload.updatedAt)}`, 'saved');
  refreshEditorDirty(prefix);
}

function scheduleBlogDraftSave(prefix) {
  if (!editorState) return;
  if (editorState.autosaveTimer) clearTimeout(editorState.autosaveTimer);
  setEditorStatus('输入中...', 'typing');
  editorState.autosaveTimer = setTimeout(() => saveBlogDraft(prefix, true), 1000);
}

function readBlogDraft() {
  if (!editorState) return null;
  const raw = localStorage.getItem(editorState.draftKey);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function removeBlogDraft() {
  if (!editorState) return;
  localStorage.removeItem(editorState.draftKey);
}

function applyDraftToForm(prefix, draft) {
  const titleId = prefix === 'edit' ? 'editTitle' : 'articleTitle';
  const summaryId = prefix === 'edit' ? 'editSummary' : 'articleSummary';
  const titleEl = document.getElementById(titleId);
  const summaryEl = document.getElementById(summaryId);
  if (titleEl && typeof draft.title === 'string') titleEl.value = draft.title;
  if (summaryEl && typeof draft.summary === 'string') summaryEl.value = draft.summary;
  if (typeof draft.content === 'string') setBlogContentValue(draft.content);
}

function showDraftBanner(prefix, draft) {
  const banner = document.getElementById('draftBanner');
  if (!banner) return;

  banner.style.display = 'flex';
  banner.innerHTML = `
    <span>检测到本地草稿（${formatClock(draft.updatedAt || Date.now())}），是否恢复？</span>
    <div class="draft-banner-actions">
      <button class="btn btn-secondary btn-sm" id="discardDraftBtn">丢弃</button>
      <button class="btn btn-primary btn-sm" id="restoreDraftBtn">恢复草稿</button>
    </div>
  `;

  const restoreBtn = document.getElementById('restoreDraftBtn');
  const discardBtn = document.getElementById('discardDraftBtn');

  if (restoreBtn) {
    restoreBtn.addEventListener('click', () => {
      applyDraftToForm(prefix, draft);
      banner.style.display = 'none';
      updateEditorStats();
      refreshEditorDirty(prefix);
      setEditorStatus('已恢复本地草稿', 'saved');
    });
  }

  if (discardBtn) {
    discardBtn.addEventListener('click', () => {
      removeBlogDraft();
      banner.style.display = 'none';
      setEditorStatus('已丢弃旧草稿', 'idle');
    });
  }
}

function bindEditorShortcut(handler) {
  if (editorShortcutHandler) {
    document.removeEventListener('keydown', editorShortcutHandler);
  }
  editorShortcutHandler = (event) => {
    const key = String(event.key || '').toLowerCase();
    if ((event.ctrlKey || event.metaKey) && key === 's') {
      event.preventDefault();
      handler();
    }
  };
  document.addEventListener('keydown', editorShortcutHandler);
}

function initBlogEditorUX({ mode, articleId, prefix, submitHandler }) {
  clearEditorRuntime();

  editorState = {
    mode,
    articleId: articleId || null,
    prefix,
    draftKey: getDraftKey(mode, articleId),
    initialSnapshot: getBlogEditorSnapshot(prefix),
    lastSavedSnapshot: '',
    dirty: false,
    autosaveTimer: null,
    allowLeave: false
  };

  const titleId = prefix === 'edit' ? 'editTitle' : 'articleTitle';
  const summaryId = prefix === 'edit' ? 'editSummary' : 'articleSummary';
  const titleEl = document.getElementById(titleId);
  const summaryEl = document.getElementById(summaryId);
  const contentEl = document.getElementById('blogPlainContent');
  const manualBtn = document.getElementById('manualDraftSaveBtn');

  const onFormInput = () => {
    updateEditorStats();
    scheduleBlogDraftSave(prefix);
    refreshEditorDirty(prefix);
  };

  if (titleEl) titleEl.addEventListener('input', onFormInput);
  if (summaryEl) summaryEl.addEventListener('input', onFormInput);
  if (contentEl) contentEl.addEventListener('input', onFormInput);
  if (manualBtn) {
    manualBtn.addEventListener('click', () => {
      saveBlogDraft(prefix, false);
      showToast('草稿已保存到本地');
    });
  }

  bindEditorShortcut(submitHandler);
  updateEditorStats();
  setEditorDirtyFlag(false);
  setEditorStatus(contentEl ? '简洁编辑器已就绪' : '编辑器已就绪', 'idle');

  const draft = readBlogDraft();
  if (draft) {
    const hasDraftContent = (draft.title || '').trim() || (draft.summary || '').trim() || (draft.content || '').trim();
    const draftSnapshot = JSON.stringify({
      title: (draft.title || '').trim(),
      summary: (draft.summary || '').trim(),
      content: (draft.content || '').replace(/\s+$/g, '')
    });
    if (hasDraftContent && draftSnapshot !== editorState.initialSnapshot) {
      showDraftBanner(prefix, draft);
    }
  }
}

function setButtonLoading(btn, loading, loadingText, originalText) {
  if (!btn) return;
  if (loading) {
    btn.disabled = true;
    btn.dataset.originalText = originalText || btn.textContent;
    btn.textContent = loadingText;
  } else {
    btn.disabled = false;
    btn.textContent = btn.dataset.originalText || originalText || btn.textContent;
  }
}

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
      const catName = isBlog() ? '博客' : '杂谈';
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

  if (isBlog()) {
    const coverHtml = a.cover_image ? `<img src="${escapeHtml(a.cover_image)}" class="article-card-cover" loading="lazy">` : "";
    const summaryText = a.summary || (a.content ? a.content.replace(/[#*`>\-\[\]!()]/g, '').slice(0, 150) : "");
    card.innerHTML = `
      ${coverHtml}
      <div class="article-card-title">${escapeHtml(a.title)}</div>
      <div class="article-card-summary">${escapeHtml(summaryText)}</div>
      <div class="article-card-meta">
        <span>${escapeHtml(a.author_name || '管理员')}</span>
        <span>${formatTime(a.created_at)}</span>
        <span>浏览 ${a.views || 0}</span>
      </div>
    `;
  } else {
    const titleHtml = a.title ? `<div class="article-card-title" style="margin-bottom:4px">${escapeHtml(a.title)}</div>` : '';
    const contentPreview = a.content ? a.content.slice(0, 200) : '';
    card.innerHTML = `
      <div class="chitchat-card-header">
        <span class="chitchat-author">${escapeHtml(a.author_name || '管理员')}</span>
        <span class="chitchat-time">${formatTime(a.created_at)}</span>
      </div>
      ${titleHtml}
      <div class="chitchat-content">${escapeHtml(contentPreview)}${a.content && a.content.length > 200 ? '...' : ''}</div>
      <div class="article-card-meta" style="margin-top:8px">
        <span>浏览 ${a.views || 0}</span>
      </div>
    `;
  }
  return card;
}

async function showArticleDetail(id) {
  if (!confirmLeaveEditor()) return;

  currentView = 'detail';
  clearEditorRuntime();
  if (vditorInstance) { vditorInstance.destroy(); vditorInstance = null; }

  const container = document.getElementById("articleContainer");
  document.getElementById("loadMoreBtn").style.display = "none";
  container.innerHTML = '<div style="text-align:center;padding:60px;color:var(--text-secondary)">加载中...</div>';
  fetch(`/api/articles/${id}/view`, { method: "POST" }).catch(() => {});

  try {
    const res = await fetch(`/api/articles/${id}`);
    if (!res.ok) throw new Error("文章不存在");
    const a = await res.json();
    let deleteBtn = "";
    let editBtn = "";
    if (currentUser && currentUser.role === "superadmin") {
      deleteBtn = `<button class="btn btn-danger btn-sm" onclick="deleteArticle(${a.id})" style="margin-left:8px">删除</button>`;
      editBtn = `<button class="btn btn-secondary btn-sm" onclick="showEditForm(${a.id})" style="margin-left:8px">编辑</button>`;
    }

    if (isBlog()) {
      const coverHtml = a.cover_image ? `<img src="${escapeHtml(a.cover_image)}" style="width:100%;max-height:300px;object-fit:cover;border-radius:8px;margin-bottom:20px">` : "";
      container.innerHTML = `
        <div class="article-detail">
          <a href="javascript:void(0)" onclick="backToList()" class="back-link" style="display:inline-block;margin-bottom:16px;color:var(--primary);text-decoration:none">← 返回列表</a>
          ${coverHtml}
          <h1 class="article-detail-title">${escapeHtml(a.title)}</h1>
          <div class="article-detail-meta">
            <span>${escapeHtml(a.author_name || '管理员')}</span>
            <span>${formatTime(a.created_at)}</span>
            <span>浏览 ${a.views || 0}</span>
            ${editBtn}${deleteBtn}
          </div>
          <div class="article-detail-content" id="articlePreview"></div>
        </div>
      `;
      const previewEl = document.getElementById("articlePreview");
      if (typeof toastui !== 'undefined' && toastui.Editor && toastui.Editor.factory) {
        toastui.Editor.factory({
          el: previewEl,
          viewer: true,
          theme: window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light',
          initialValue: a.content || ''
        });
      } else if (typeof Vditor !== 'undefined' && Vditor.preview) {
        Vditor.preview(previewEl, a.content, {
          theme: { current: window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light' },
          hljs: { lineNumber: true }
        });
      } else {
        previewEl.innerHTML = escapeHtml(a.content).replace(/\n/g, '<br>');
      }
    } else {
      const titleHtml = a.title ? `<h1 class="article-detail-title">${escapeHtml(a.title)}</h1>` : '';
      container.innerHTML = `
        <div class="article-detail">
          <a href="javascript:void(0)" onclick="backToList()" class="back-link" style="display:inline-block;margin-bottom:16px;color:var(--primary);text-decoration:none">← 返回列表</a>
          ${titleHtml}
          <div class="article-detail-meta">
            <span>${escapeHtml(a.author_name || '管理员')}</span>
            <span>${formatTime(a.created_at)}</span>
            <span>浏览 ${a.views || 0}</span>
            ${editBtn}${deleteBtn}
          </div>
          <div class="article-detail-content">${escapeHtml(a.content).replace(/\n/g, '<br>')}</div>
        </div>
      `;
    }

    const cat = window.ARTICLE_CATEGORY;
    history.pushState({ detail: id }, "", `/${cat}/${id}`);
    document.title = (a.title || '杂谈') + (isBlog() ? ' - 博客' : ' - 杂谈');
  } catch (err) {
    container.innerHTML = `<div style="text-align:center;padding:60px;color:#ef4444">${err.message}</div>`;
  }
}

function backToList() {
  if (!confirmLeaveEditor()) return;

  currentView = 'list';
  currentPage = 1;
  clearEditorRuntime();
  if (vditorInstance) { vditorInstance.destroy(); vditorInstance = null; }
  document.getElementById("articleContainer").innerHTML = "";
  loadArticles();
  const cat = window.ARTICLE_CATEGORY;
  history.replaceState(null, "", `/${cat}`);
  document.title = isBlog() ? '博客' : '杂谈';
}

window.addEventListener("popstate", () => {
  const cat = window.ARTICLE_CATEGORY;
  const m = window.location.pathname.match(new RegExp(`^/(space/)?${cat}/(\\d+)$`));
  if (m) { showArticleDetail(parseInt(m[2], 10)); }
  else { backToList(); }
});

function showPublishForm() {
  currentView = 'publish';
  clearEditorRuntime();

  const container = document.getElementById("articleContainer");
  document.getElementById("loadMoreBtn").style.display = "none";
  const catName = isBlog() ? '博客' : '杂谈';

  if (isBlog()) {
    container.innerHTML = `
      <div class="article-form article-editor-form">
        <a href="javascript:void(0)" onclick="backToList()" class="back-link" style="display:inline-block;margin-bottom:16px;color:var(--primary);text-decoration:none">← 返回列表</a>
        <h2 style="margin-bottom:14px">发布${catName}</h2>
        <div class="editor-panel">
          <div class="editor-topbar">
            <div class="editor-status-group">
              <span class="editor-pill" id="editorStatus" data-state="idle">编辑器已就绪</span>
              <span class="editor-dirty" id="editorDirtyFlag" data-state="clean">内容已同步</span>
            </div>
            <div class="editor-stats">
              <span id="editorWordCount">0 字</span>
              <span>·</span>
              <span id="editorReadTime">预计阅读 1 分钟</span>
              <span>·</span>
              <span class="editor-shortcut">Ctrl/⌘ + S</span>
            </div>
          </div>
          <div class="draft-banner" id="draftBanner" style="display:none"></div>
          <div class="article-form-grid">
            <input type="text" id="articleTitle" placeholder="标题" maxlength="200" autocomplete="off">
            <input type="text" id="articleSummary" placeholder="摘要（选填，不填自动截取）" maxlength="300" autocomplete="off">
          </div>
          <div class="cover-upload-box">
            <label class="cover-upload-label">
              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block;vertical-align:-2px"><rect width="18" height="18" x="3" y="3" rx="2" ry="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/></svg>
              封面图（选填）
              <input type="file" id="articleCover" accept="image/*" hidden onchange="previewCover(this)">
            </label>
            <div id="coverPreview"></div>
          </div>
          <div id="vditorEditor"></div>
          <textarea id="blogPlainContent" class="blog-fallback-textarea" placeholder="正文（Markdown）" rows="16" style="display:none"></textarea>
          <div class="article-form-actions" style="margin-top:12px">
            <button class="btn btn-secondary" id="manualDraftSaveBtn" type="button">保存草稿</button>
            <button class="btn btn-secondary" onclick="backToList()" type="button">取消</button>
            <button class="btn btn-primary" id="submitArticleBtn" onclick="submitArticle()" type="button">发布</button>
          </div>
        </div>
      </div>
    `;

    const plainEditor = document.getElementById('blogPlainContent');
    const vditorEl = document.getElementById('vditorEditor');

    if ((typeof toastui !== 'undefined' && toastui.Editor) || typeof Vditor !== 'undefined') {
      if (vditorEl) vditorEl.style.display = '';
      if (plainEditor) plainEditor.style.display = 'none';
      try {
        initVditor('vditorEditor', '', {
          onInput: () => {
            if (!editorState || editorState.prefix !== 'article') return;
            updateEditorStats();
            scheduleBlogDraftSave('article');
            refreshEditorDirty('article');
          },
          onReady: () => {
            initBlogEditorUX({
              mode: 'create',
              articleId: null,
              prefix: 'article',
              submitHandler: () => submitArticle(true)
            });
          }
        });
      } catch {
        if (vditorEl) vditorEl.style.display = 'none';
        if (plainEditor) plainEditor.style.display = '';
        initBlogEditorUX({
          mode: 'create',
          articleId: null,
          prefix: 'article',
          submitHandler: () => submitArticle(true)
        });
        setEditorStatus('高级编辑器加载失败，已切换简洁模式', 'dirty');
      }
    } else {
      if (vditorEl) vditorEl.style.display = 'none';
      if (plainEditor) plainEditor.style.display = '';
      initBlogEditorUX({
        mode: 'create',
        articleId: null,
        prefix: 'article',
        submitHandler: () => submitArticle(true)
      });
      setEditorStatus('高级编辑器不可用，已切换简洁模式', 'dirty');
    }
  } else {
    container.innerHTML = `
      <div class="article-form chitchat-form">
        <a href="javascript:void(0)" onclick="backToList()" class="back-link" style="display:inline-block;margin-bottom:16px;color:var(--primary);text-decoration:none">← 返回</a>
        <input type="text" id="articleTitle" placeholder="标题（选填）" maxlength="200">
        <textarea id="articleContent" placeholder="说点什么..." rows="6" style="resize:vertical"></textarea>
        <div class="article-form-actions" style="margin-top:8px">
          <button class="btn btn-secondary" onclick="backToList()">取消</button>
          <button class="btn btn-primary" onclick="submitArticle()">发布</button>
        </div>
      </div>
    `;
  }
}

function previewCover(input) {
  const preview = document.getElementById("coverPreview");
  if (input.files && input.files[0]) {
    const reader = new FileReader();
    reader.onload = (e) => {
      preview.innerHTML = `
        <div class="cover-preview-card">
          <img src="${e.target.result}" class="cover-preview-image">
          <button onclick="clearCover()" class="btn btn-secondary btn-sm" type="button">移除</button>
        </div>
      `;
    };
    reader.readAsDataURL(input.files[0]);
  }
}

function clearCover() {
  const input = document.getElementById("articleCover");
  if (input) input.value = "";
  const preview = document.getElementById("coverPreview");
  if (preview) preview.innerHTML = "";
}

async function submitArticle(fromShortcut = false) {
  const titleEl = document.getElementById("articleTitle");
  const title = titleEl ? titleEl.value.trim() : '';
  let content = '';

  if (isBlog()) {
    content = getBlogEditorData('article').content.trim();
  } else {
    const contentEl = document.getElementById("articleContent");
    content = contentEl ? contentEl.value.trim() : '';
  }

  if (isBlog() && !title) return showToast("请输入标题");
  if (!content) return showToast("请输入内容");
  if (!currentUser || !currentUser.token) return showToast("请先登录");

  const finalTitle = title || content.slice(0, 30);

  const formData = new FormData();
  formData.append("title", finalTitle);
  formData.append("content", content);
  formData.append("category", window.ARTICLE_CATEGORY);

  if (isBlog()) {
    const summary = document.getElementById("articleSummary");
    if (summary && summary.value.trim()) formData.append("summary", summary.value.trim());
    const coverInput = document.getElementById("articleCover");
    if (coverInput && coverInput.files && coverInput.files[0]) formData.append("cover", coverInput.files[0]);
  }

  const submitBtn = document.getElementById('submitArticleBtn');
  setButtonLoading(submitBtn, true, '发布中...', '发布');
  if (fromShortcut) setEditorStatus('正在发布...', 'typing');

  try {
    const res = await fetch("/api/articles", {
      method: "POST",
      headers: { "Authorization": "Bearer " + currentUser.token },
      body: formData
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error);
    }

    if (isBlog() && editorState) {
      editorState.allowLeave = true;
      removeBlogDraft();
    }

    showToast("发布成功");
    backToList();
  } catch (err) {
    showToast(err.message);
  } finally {
    setButtonLoading(submitBtn, false, '发布中...', '发布');
  }
}

async function showEditForm(id) {
  currentView = 'edit';
  clearEditorRuntime();

  const container = document.getElementById("articleContainer");
  document.getElementById("loadMoreBtn").style.display = "none";

  try {
    const res = await fetch(`/api/articles/${id}`);
    const a = await res.json();

    if (isBlog()) {
      container.innerHTML = `
        <div class="article-form article-editor-form">
          <a href="javascript:void(0)" onclick="showArticleDetail(${id})" class="back-link" style="display:inline-block;margin-bottom:16px;color:var(--primary);text-decoration:none">← 返回文章</a>
          <h2 style="margin-bottom:14px">编辑文章</h2>
          <div class="editor-panel">
            <div class="editor-topbar">
              <div class="editor-status-group">
                <span class="editor-pill" id="editorStatus" data-state="idle">编辑器已就绪</span>
                <span class="editor-dirty" id="editorDirtyFlag" data-state="clean">内容已同步</span>
              </div>
              <div class="editor-stats">
                <span id="editorWordCount">0 字</span>
                <span>·</span>
                <span id="editorReadTime">预计阅读 1 分钟</span>
                <span>·</span>
                <span class="editor-shortcut">Ctrl/⌘ + S</span>
              </div>
            </div>
            <div class="draft-banner" id="draftBanner" style="display:none"></div>
            <div class="article-form-grid">
              <input type="text" id="editTitle" placeholder="标题" maxlength="200" value="${escapeAttr(a.title)}" autocomplete="off">
              <input type="text" id="editSummary" placeholder="摘要（选填）" maxlength="300" value="${escapeAttr(a.summary || '')}" autocomplete="off">
            </div>
            <div class="cover-upload-box">
              <label class="cover-upload-label">
                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block;vertical-align:-2px"><rect width="18" height="18" x="3" y="3" rx="2" ry="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/></svg>
                更换封面图
                <input type="file" id="editCover" accept="image/*" hidden onchange="previewEditCover(this)">
              </label>
              <div id="editCoverPreview">${a.cover_image ? `<div class="cover-preview-card"><img src="${escapeHtml(a.cover_image)}" class="cover-preview-image"></div>` : ''}</div>
            </div>
            <div id="vditorEditor"></div>
            <textarea id="blogPlainContent" class="blog-fallback-textarea" rows="16" style="display:none">${escapeHtml(a.content || '')}</textarea>
            <div class="article-form-actions" style="margin-top:12px">
              <button class="btn btn-secondary" id="manualDraftSaveBtn" type="button">保存草稿</button>
              <button class="btn btn-secondary" onclick="showArticleDetail(${id})" type="button">取消</button>
              <button class="btn btn-primary" id="updateArticleBtn" onclick="updateArticle(${id})" type="button">保存</button>
            </div>
          </div>
        </div>
      `;

      const plainEditor = document.getElementById('blogPlainContent');
      const vditorEl = document.getElementById('vditorEditor');

      if ((typeof toastui !== 'undefined' && toastui.Editor) || typeof Vditor !== 'undefined') {
        if (vditorEl) vditorEl.style.display = '';
        if (plainEditor) plainEditor.style.display = 'none';
        try {
          initVditor('vditorEditor', a.content || '', {
            onInput: () => {
              if (!editorState || editorState.prefix !== 'edit') return;
              updateEditorStats();
              scheduleBlogDraftSave('edit');
              refreshEditorDirty('edit');
            },
            onReady: () => {
              initBlogEditorUX({
                mode: 'edit',
                articleId: id,
                prefix: 'edit',
                submitHandler: () => updateArticle(id, true)
              });
            }
          });
        } catch {
          if (vditorEl) vditorEl.style.display = 'none';
          if (plainEditor) plainEditor.style.display = '';
          initBlogEditorUX({
            mode: 'edit',
            articleId: id,
            prefix: 'edit',
            submitHandler: () => updateArticle(id, true)
          });
          setEditorStatus('高级编辑器加载失败，已切换简洁模式', 'dirty');
        }
      } else {
        if (vditorEl) vditorEl.style.display = 'none';
        if (plainEditor) plainEditor.style.display = '';
        initBlogEditorUX({
          mode: 'edit',
          articleId: id,
          prefix: 'edit',
          submitHandler: () => updateArticle(id, true)
        });
        setEditorStatus('高级编辑器不可用，已切换简洁模式', 'dirty');
      }
    } else {
      container.innerHTML = `
        <div class="article-form chitchat-form">
          <a href="javascript:void(0)" onclick="showArticleDetail(${id})" class="back-link" style="display:inline-block;margin-bottom:16px;color:var(--primary);text-decoration:none">← 返回</a>
          <input type="text" id="editTitle" placeholder="标题（选填）" maxlength="200" value="${escapeAttr(a.title)}">
          <textarea id="editContent" placeholder="说点什么..." rows="6" style="resize:vertical">${escapeHtml(a.content)}</textarea>
          <div class="article-form-actions" style="margin-top:8px">
            <button class="btn btn-secondary" onclick="showArticleDetail(${id})">取消</button>
            <button class="btn btn-primary" onclick="updateArticle(${id})">保存</button>
          </div>
        </div>
      `;
    }
  } catch (err) {
    showToast("加载失败");
  }
}

function previewEditCover(input) {
  const preview = document.getElementById("editCoverPreview");
  if (input.files && input.files[0]) {
    const reader = new FileReader();
    reader.onload = (e) => {
      preview.innerHTML = `
        <div class="cover-preview-card">
          <img src="${e.target.result}" class="cover-preview-image">
        </div>
      `;
    };
    reader.readAsDataURL(input.files[0]);
  }
}

async function updateArticle(id, fromShortcut = false) {
  const titleEl = document.getElementById("editTitle");
  const title = titleEl ? titleEl.value.trim() : '';
  let content = '';

  if (isBlog()) {
    content = getBlogEditorData('edit').content.trim();
  } else {
    const contentEl = document.getElementById("editContent");
    content = contentEl ? contentEl.value.trim() : '';
  }

  if (isBlog() && !title) return showToast("请输入标题");
  if (!content) return showToast("请输入内容");
  if (!currentUser || !currentUser.token) return showToast("请先登录");

  const finalTitle = title || content.slice(0, 30);
  const formData = new FormData();
  formData.append("title", finalTitle);
  formData.append("content", content);

  if (isBlog()) {
    const summary = document.getElementById("editSummary");
    if (summary && summary.value.trim()) formData.append("summary", summary.value.trim());
    const coverInput = document.getElementById("editCover");
    if (coverInput && coverInput.files && coverInput.files[0]) formData.append("cover", coverInput.files[0]);
  }

  const updateBtn = document.getElementById('updateArticleBtn');
  setButtonLoading(updateBtn, true, '保存中...', '保存');
  if (fromShortcut) setEditorStatus('正在保存...', 'typing');

  try {
    const res = await fetch(`/api/articles/${id}`, {
      method: "PUT",
      headers: { "Authorization": "Bearer " + currentUser.token },
      body: formData
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error);
    }

    if (isBlog() && editorState) {
      editorState.allowLeave = true;
      removeBlogDraft();
    }

    showToast("已保存");
    showArticleDetail(id);
  } catch (err) {
    showToast(err.message);
  } finally {
    setButtonLoading(updateBtn, false, '保存中...', '保存');
  }
}

async function deleteArticle(id) {
  if (!confirm("确定要删除吗？")) return;
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

function escapeHtml(t) { if (!t) return ''; const d = document.createElement("div"); d.textContent = t; return d.innerHTML; }
function escapeAttr(t) { if (!t) return ''; return t.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#39;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
function formatTime(dateStr) {
  const date = new Date(dateStr);
  const now = new Date();
  const diff = (now - date) / 1000;
  if (diff < 60) return "刚刚";
  if (diff < 3600) return Math.floor(diff / 60) + " 分钟前";
  if (diff < 86400) return Math.floor(diff / 3600) + " 小时前";
  if (diff < 604800) return Math.floor(diff / 86400) + " 天前";
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  const h = String(date.getHours()).padStart(2, "0");
  const min = String(date.getMinutes()).padStart(2, "0");
  return y === now.getFullYear() ? `${m}-${d} ${h}:${min}` : `${y}-${m}-${d} ${h}:${min}`;
}
function showToast(msg) {
  const t = document.getElementById("toast");
  if (!t) return;
  t.textContent = msg;
  t.classList.add("show");
  setTimeout(() => t.classList.remove("show"), 2500);
}
function goLogin() { window.location.href = "/space/#login"; }
function doLogout() {
  const token = localStorage.getItem("ps_main_token") || localStorage.getItem("token");
  if (token) fetch("/api/logout", { method: "POST", headers: { "Authorization": "Bearer " + token } }).catch(() => {});
  currentUser = null;
  localStorage.removeItem("token");
  localStorage.removeItem("ps_main_token");
  updateUI();
  showToast("已退出");
}
