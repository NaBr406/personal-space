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

// ========== 状态管理 ==========
let currentUser = null;
let notifTimer = null;

function startNotifPolling() {
  loadNotifications();
  if (notifTimer) clearInterval(notifTimer);
  notifTimer = setInterval(loadNotifications, 30000);
}
function stopNotifPolling() {
  if (notifTimer) { clearInterval(notifTimer); notifTimer = null; }
  const badge = document.getElementById("notifBadge");
  if (badge) { badge.textContent = ""; badge.style.display = "none"; }
}
let currentPage = 1;
let totalPages = 1;
let loading = false;
let searchStart = "";
let searchEnd = "";
let viewMode = "list"; // list | detail | admin

// ========== 初始化 ==========
document.addEventListener("DOMContentLoaded", async () => {
  const token = localStorage.getItem("ps_main_token") || ((localStorage.getItem("token") && !localStorage.getItem("token").startsWith("eyJ")) ? localStorage.getItem("token") : "");
  if (token) {
    const user = await fetchMe(token);
    if (user) {
      currentUser = user;
      currentUser.token = token;
    }
  }
  updateUI();
  if (currentUser) startNotifPolling();
  reportVisit();
  loadVisitors();

  // 路由解析：如果是 /post/:id 直接显示详情
  const pathMatch = window.location.pathname.match(/^\/(space\/)?post\/(\d+)$/);
  if (pathMatch) {
    showDetail(parseInt(pathMatch[2]));
  } else {
    loadPosts();
  }

  // 从主页跳转来的 #login 锚点
  if (window.location.hash === "#login" && !currentUser) {
    setTimeout(() => showAuthModal("login"), 300);
    history.replaceState(null, "", window.location.pathname);
  }
});

// ========== 认证 ==========
async function fetchMe(token) {
  try {
    const res = await fetch("/api/me", { headers: { "Authorization": "Bearer " + token } });
    if (!res.ok) { if (res.status === 401 || res.status === 403) { localStorage.removeItem("token"); localStorage.removeItem("ps_main_token"); } return null; }
    return await res.json();
  } catch { return null; }
}

function showAuthModal(mode) {
  document.getElementById("authTitle").textContent = mode === "login" ? "登录" : "注册";
  document.getElementById("authSubmitBtn").textContent = mode === "login" ? "登录" : "注册";
  const captchaRow = document.getElementById("captchaRow");
  if (mode === "register") { captchaRow.style.display = "flex"; refreshCaptcha(); }
  else { captchaRow.style.display = "none"; }
  document.getElementById("authSubmitBtn").onclick = mode === "login" ? doLogin : doRegister;
  document.getElementById("nicknameRow").style.display = mode === "login" ? "none" : "block";
  document.getElementById("inviteRow").style.display = mode === "login" ? "none" : "block";
  document.getElementById("authSwitch").innerHTML = mode === "login"
    ? '没有账号？<a href="javascript:void(0)" onclick="showAuthModal(\'register\')">去注册</a> &nbsp;&nbsp; <a href="javascript:void(0)" onclick="closeAuthModal();showResetModal()" style="color:var(--muted);font-size:0.9em">忘记密码?</a>'
    : '已有账号？<a href="javascript:void(0)" onclick="showAuthModal(\'login\')">去登录</a>';
  document.getElementById("authModal").classList.add("show");
  document.getElementById("authUsername").value = "";
  document.getElementById("authPassword").value = "";
  document.getElementById("authNickname").value = "";
  document.getElementById("authUsername").focus();
}

function closeAuthModal() {
  document.getElementById("authModal").classList.remove("show");
}

async function doLogin() {
  const username = document.getElementById("authUsername").value.trim();
  const password = document.getElementById("authPassword").value.trim();
  if (!username || !password) { showToast("请填写完整"); return; }

  try {
    const res = await fetch("/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);

    currentUser = data;
    localStorage.setItem("token", data.token);
    localStorage.setItem("ps_main_token", data.token);
    closeAuthModal();
    updateUI();
    currentPage = 1;
    document.getElementById("feed").innerHTML = "";
    loadPosts();
    showToast("欢迎回来，" + data.nickname + "");
    startNotifPolling();
  } catch (err) { showToast(err.message); }
}

let captchaToken = "";
async function refreshCaptcha() {
  try {
    const res = await fetch("/api/captcha");
    const data = await res.json();
    document.getElementById("captchaQuestion").textContent = data.question;
    document.getElementById("captchaInput").value = "";
    captchaToken = data.token;
  } catch (e) { showToast("获取验证码失败"); }
}

async function doRegister() {
  const username = document.getElementById("authUsername").value.trim();
  const password = document.getElementById("authPassword").value.trim();
  const nickname = document.getElementById("authNickname").value.trim();
  if (!username || !password) { showToast("请填写完整"); return; }

  try {
    const captchaAnswer = document.getElementById("captchaInput").value.trim();
    if (!captchaAnswer) { showToast("请输入验证码答案"); return; }
    const res = await fetch("/api/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password, nickname, captchaToken, captchaAnswer, inviteCode: document.getElementById("authInviteCode").value.trim() })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);

    currentUser = data;
    localStorage.setItem("token", data.token);
    localStorage.setItem("ps_main_token", data.token);
    closeAuthModal();
    updateUI();
    showToast("注册成功，欢迎 " + data.nickname + "");
    startNotifPolling();
  } catch (err) { showToast(err.message); }
}

function doLogout() {
  const token = localStorage.getItem("ps_main_token") || ((localStorage.getItem("token") && !localStorage.getItem("token").startsWith("eyJ")) ? localStorage.getItem("token") : "");
  if (token) fetch("/api/logout", { method: "POST", headers: { "Authorization": "Bearer " + token } }).catch(() => {});
  currentUser = null;
  localStorage.removeItem("token");
  localStorage.removeItem("ps_main_token");
  stopNotifPolling();
  updateUI();
  currentPage = 1;
  document.getElementById("feed").innerHTML = "";
  loadPosts();
  showToast("已退出");
}

// ========== UI 更新 ==========
function updateUI() {
  const loginArea = document.getElementById("loginArea");
  const userArea = document.getElementById("userArea");
  const publishArea = document.getElementById("publishArea");

  if (currentUser) {
    loginArea.style.display = "none";
    userArea.style.display = "flex";
    document.getElementById("userAvatar").src = currentUser.avatar || "/default-avatar.png";
    document.getElementById("userNickname").textContent = currentUser.nickname;

    const canPost = currentUser.role === "admin" || currentUser.role === "superadmin";
    publishArea.style.display = canPost ? "block" : "none";

    const adminBtn = document.getElementById("btnAdmin");
    adminBtn.style.display = currentUser.role === "superadmin" ? "" : "none";
  } else {
    loginArea.style.display = "flex";
    userArea.style.display = "none";
    publishArea.style.display = "none";
  }
}

// ========== 时间查找 ==========
function toggleSearch() {
  const drawer = document.getElementById("searchDrawer");
  drawer.classList.toggle("open");
}

function doSearch() {
  searchStart = document.getElementById("searchStart").value;
  searchEnd = document.getElementById("searchEnd").value;
  currentPage = 1;
  document.getElementById("feed").innerHTML = "";
  loadPosts();
}

function clearSearch() {
  document.getElementById("searchStart").value = "";
  document.getElementById("searchEnd").value = "";
  searchStart = "";
  searchEnd = "";
  currentPage = 1;
  document.getElementById("feed").innerHTML = "";
  loadPosts();
}

// ========== 动态加载 ==========
async function loadPosts() {
  if (loading) return;
  loading = true;
  const feed = document.getElementById("feed");
  const loadMoreDiv = document.getElementById("loadMore");
  const emptyState = document.getElementById("emptyState");

  try {
    let url = `/api/posts?page=${currentPage}&limit=10`;
    if (searchStart) url += `&start=${searchStart}`;
    if (searchEnd) url += `&end=${searchEnd}`;

    const _headers = {}; if (currentUser) _headers["Authorization"] = "Bearer " + currentUser.token; const res = await fetch(url, { headers: _headers });
    const data = await res.json();

    if (currentPage === 1 && data.posts.length === 0) {
      emptyState.style.display = "block";
      loadMoreDiv.style.display = "none";
    } else {
      emptyState.style.display = "none";
      data.posts.forEach(post => {
        feed.appendChild(createPostCard(post));
      });
      totalPages = data.pagination.pages;
      loadMoreDiv.style.display = currentPage < totalPages ? "block" : "none";
      currentPage++;
    }
  } catch (err) { showToast("加载失败: " + err.message); }
  finally { loading = false; }
}

function recordView(postId) {
  fetch(`/api/posts/${postId}/view`, { method: "POST" }).catch(() => {});
}


function buildImageGrid(post, maxH) {
  let imgs = [];
  let thumbs = [];
  try { if (post.images) imgs = JSON.parse(post.images); } catch(e) {}
  try { if (post.thumbnails) thumbs = JSON.parse(post.thumbnails); } catch(e) {}
  // fallback to single image
  if (!imgs.length && post.image) { imgs = [post.image]; thumbs = [post.thumbnail || post.image]; }
  if (!imgs.length) return "";
  const count = imgs.length;
  const cls = count === 1 ? "img-grid-1" : count <= 3 ? "img-grid-3" : "img-grid-4";
  const items = imgs.map((img, i) => {
    const thumb = thumbs[i] || img;
    return `<div class="img-grid-item" onclick="viewImages(${JSON.stringify(imgs).replace(/"/g, '&quot;')}, ${i})"><img src="${escapeHtml(thumb)}" alt="" loading="lazy"></div>`;
  }).join("");
  return `<div class="img-grid ${cls}">${items}</div>`;
}

function viewImages(imgs, startIdx) {
  let idx = startIdx || 0;
  const overlay = document.createElement("div");
  overlay.className = "img-viewer-overlay";
  const render = () => {
    overlay.innerHTML = `
      <div class="img-viewer-close" onclick="this.parentElement.remove()">✕</div>
      <div class="img-viewer-counter">${idx+1} / ${imgs.length}</div>
      ${imgs.length > 1 ? '<div class="img-viewer-prev" onclick="event.stopPropagation()">‹</div>' : ''}
      ${imgs.length > 1 ? '<div class="img-viewer-next" onclick="event.stopPropagation()">›</div>' : ''}
      <img src="${imgs[idx]}" class="img-viewer-img" onclick="event.stopPropagation()">
    `;
    if (imgs.length > 1) {
      overlay.querySelector('.img-viewer-prev').onclick = (e) => { e.stopPropagation(); idx = (idx - 1 + imgs.length) % imgs.length; render(); };
      overlay.querySelector('.img-viewer-next').onclick = (e) => { e.stopPropagation(); idx = (idx + 1) % imgs.length; render(); };
    }
  };
  overlay.onclick = () => overlay.remove();
  document.body.appendChild(overlay);
  render();
}

function createPostCard(post) {
  const card = document.createElement("div");
  card.className = "card post-card";
  card.dataset.id = post.id;
  card.style.cursor = "pointer";
  card.addEventListener("click", (e) => {
    if (e.target.tagName === "IMG" || e.target.tagName === "BUTTON" || e.target.closest(".btn-delete") || e.target.closest(".btn-like")) return;
    showDetail(post.id);
  });

  let contentHtml = post.content ? `<div class="post-content">${escapeHtml(post.content)}</div>` : "";
  let imageHtml = buildImageGrid(post, 300);

  // 发布者信息
  let authorHtml = "";
  if (post.author_name) {
    authorHtml = `<div class="post-author"><img src="${escapeHtml(post.author_avatar || '/default-avatar.png')}" class="author-avatar"><span>${escapeHtml(post.author_name)}</span></div>`;
  }

  // 点赞按钮
  const liked = post.liked ? "liked" : "";
  const likeBtn = `<button class="btn-like ${liked}" onclick="toggleLike(${post.id}, this)"><svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block;vertical-align:-2px"><path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"/></svg> <span>${post.like_count || 0}</span></button>`;

  let deleteBtn = "";
  if (currentUser && (currentUser.role === "superadmin" || (post.user_id && post.user_id === currentUser.id))) {
    deleteBtn = `<button class="btn-delete" onclick="deletePost(${post.id})"><svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block;vertical-align:-2px"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/></svg></button>`;
  }

  card.innerHTML = `
    ${authorHtml}
    ${contentHtml}
    ${imageHtml}
    <div class="post-footer">
      <span class="post-time">${formatTime(post.created_at)}</span>
      <span class="post-views"><svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block;vertical-align:-2px"><path d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0"/><circle cx="12" cy="12" r="3"/></svg> ${post.views || 0}</span>
      <button class="btn-comment" onclick="event.stopPropagation();showDetail(${post.id})" style="background:none;border:none;cursor:pointer;color:var(--text-secondary);display:inline-flex;align-items:center;gap:3px;font-size:0.9em"><svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block;vertical-align:-2px"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg> <span>${post.comment_count || 0}</span></button>
      ${likeBtn}
      ${deleteBtn}
    </div>
  `;
  return card;
}

// ========== 点赞 ==========
async function toggleLike(postId, btn) {
  if (!currentUser) { showAuthModal("login"); return; }

  try {
    const res = await fetch(`/api/posts/${postId}/like`, {
      method: "POST",
      headers: { "Authorization": "Bearer " + currentUser.token }
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);

    btn.classList.toggle("liked", data.liked);
    btn.querySelector("span").textContent = data.count;
  } catch (err) { showToast(err.message); }
}

// ========== 发布动态 ==========
async function submitPost() {
  const content = document.getElementById("postContent").value.trim();
  const imageInput = document.getElementById("postImages");
  const files = imageInput ? imageInput.files : [];

  if (!content && !files.length) {
    showToast("请输入内容或选择图片");
    return;
  }

  const formData = new FormData();
  if (content) formData.append("content", content);
  for (let i = 0; i < files.length; i++) {
    formData.append("images", files[i]);
  }

  try {
    const res = await fetch("/api/posts", {
      method: "POST",
      headers: { "Authorization": "Bearer " + currentUser.token },
      body: formData
    });
    if (!res.ok) { const err = await res.json(); throw new Error(err.error); }

    const post = await res.json();
    document.getElementById("postContent").value = "";
    clearImages();

    const feed = document.getElementById("feed");
    const card = createPostCard(post);
    feed.insertBefore(card, feed.firstChild);
    document.getElementById("emptyState").style.display = "none";
    showToast("发布成功");
  } catch (err) { showToast("发布失败: " + err.message); }
}

// ========== 删除动态 ==========
async function deletePost(id) {
  if (!confirm("确定要删除这条动态吗？")) return;
  try {
    const res = await fetch(`/api/posts/${id}`, {
      method: "DELETE",
      headers: { "Authorization": "Bearer " + currentUser.token }
    });
    if (!res.ok) { const err = await res.json(); throw new Error(err.error); }

    const card = document.querySelector(`.post-card[data-id="${id}"]`);
    if (card) {
      card.style.opacity = "0";
      card.style.transform = "translateY(-10px)";
      setTimeout(() => card.remove(), 300);
    }
    showToast("已删除");
  } catch (err) { showToast(err.message); }
}

// ========== SPA 详情页 ==========
function isDesktop() { return window.innerWidth > 768; }

async function showDetail(id) {
  const feed = document.getElementById("feed");
  const loadMoreDiv = document.getElementById("loadMore");
  const pagination = document.getElementById("pagination");
  const desktop = isDesktop();

  if (!desktop) {
    // 手机端：隐藏列表
    feed.style.display = "none";
    if (loadMoreDiv) loadMoreDiv.style.display = "none";
    if (pagination) pagination.style.display = "none";
    const fab = document.getElementById("fab");
    if (fab) fab.style.display = "none";
  }

  // 确保 detailView 容器存在
  let detailView = document.getElementById("detailView");
  if (!detailView) {
    detailView = document.createElement("div");
    detailView.id = "detailView";
    feed.parentNode.insertBefore(detailView, feed.nextSibling);
  }

  // PC端：抽屉模式
  if (desktop) {
    detailView.classList.add("drawer-mode");
    detailView.classList.remove("drawer-open");
    let overlay = document.getElementById("drawerOverlay");
    if (!overlay) {
      overlay = document.createElement("div");
      overlay.id = "drawerOverlay";
      overlay.className = "drawer-overlay";
      overlay.onclick = () => backToList();
      document.body.appendChild(overlay);
    }
    overlay.classList.add("show");
    document.body.style.overflow = "hidden";
  } else {
    detailView.classList.remove("drawer-mode", "drawer-open");
  }

  detailView.style.display = "";
  detailView.innerHTML = '<div style="text-align:center;padding:60px;color:var(--text-secondary)">加载中...</div>';

  fetch(`/api/posts/${id}/view`, { method: "POST" }).catch(() => {});

  try {
    const _h2 = {}; if (currentUser) _h2["Authorization"] = "Bearer " + currentUser.token; const res = await fetch(`/api/posts/${id}`, { headers: _h2 });
    if (!res.ok) throw new Error("动态不存在");
    const post = await res.json();

    let authorHtml = "";
    if (post.author_name) {
      authorHtml = `<div class="post-author"><img src="${escapeHtml(post.author_avatar || '/default-avatar.png')}" class="author-avatar"><span>${escapeHtml(post.author_name)}</span></div>`;
    }
    let contentHtml = post.content ? `<div class="post-content" style="font-size:1.05rem;line-height:1.9">${escapeHtml(post.content)}</div>` : "";
    let imageHtml = buildImageGrid(post, 600);

    const liked = post.liked ? "liked" : "";
    const likeBtn = `<button class="btn-like ${liked}" onclick="toggleLike(${post.id}, this)"><svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block;vertical-align:-2px"><path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"/></svg> <span>${post.like_count || 0}</span></button>`;

    detailView.innerHTML = `
      <a href="javascript:void(0)" onclick="backToList()" class="back-link">← 返回</a>
      <div class="card post-card" style="cursor:default">
        ${authorHtml}
        ${contentHtml}
        ${imageHtml}
        <div class="post-footer">
          <span class="post-time">📅 ${formatTime(post.created_at)}</span>
          <span class="post-views"><svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block;vertical-align:-2px"><path d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0"/><circle cx="12" cy="12" r="3"/></svg> ${post.views || 0}</span>
          ${likeBtn}
        </div>
      </div>
    `;


    // 评论区
    const commentSection = document.createElement("div");
    commentSection.className = "comment-section";

    let commentInputHtml = "";
    if (currentUser) {
      commentInputHtml = `
        <div class="comment-reply-hint" id="replyHint" style="display:none">
          <span id="replyHintText"></span>
          <button class="comment-reply-cancel" onclick="cancelReply()">✕</button>
        </div>
        <div class="comment-input">
          <input type="text" id="commentInput" placeholder="写评论..." maxlength="500" onkeydown="if(event.key==='Enter')submitComment(${post.id})">
          <button class="btn btn-primary btn-sm" onclick="submitComment(${post.id})">发送</button>
        </div>`;
    }

    commentSection.innerHTML = `
      <h4>💬 评论</h4>
      ${commentInputHtml}
      <div id="commentList"><div class="comment-empty">加载评论中...</div></div>
    `;
    detailView.appendChild(commentSection);
    loadComments(post.id);

    if (!desktop) {
      detailView.style.opacity = "0";
      detailView.style.transform = "translateY(8px)";
      detailView.style.transition = "opacity 0.25s ease, transform 0.25s ease";
      requestAnimationFrame(() => {
        detailView.style.opacity = "1";
        detailView.style.transform = "translateY(0)";
      });
    } else {
      requestAnimationFrame(() => {
        detailView.classList.add("drawer-open");
      });
    }

    history.pushState({ detail: id }, "", "/space/post/" + id);
    document.title = (post.content ? post.content.slice(0, 30) : "图片动态") + " - 我的空间";
    viewMode = "detail";
  } catch (err) {
    detailView.innerHTML = `<div style="text-align:center;padding:60px;color:#ef4444">😢 ${err.message}</div>`;
  }
}

function backToList() {
  showList();
  const feed = document.getElementById("feed");
  if (feed && feed.children.length === 0) loadPosts();
  history.replaceState({ list: true }, "", "/space/");
}

function showList() {
  viewMode = "list";
  const detailView = document.getElementById("detailView");
  if (detailView) {
    detailView.style.display = "none";
    detailView.classList.remove("drawer-mode", "drawer-open");
  }
  // 关闭抽屉遮罩
  const overlay = document.getElementById("drawerOverlay");
  if (overlay) overlay.classList.remove("show");
  document.body.style.overflow = "";

  document.getElementById("feed").style.display = "";
  const pagination = document.getElementById("pagination");
  if (pagination) pagination.style.display = "";
  const loadMore = document.getElementById("loadMore");
  if (loadMore) loadMore.style.display = "";
  const fab = document.getElementById("fab");
  if (fab) fab.style.display = "";
  document.title = "我的空间";
}

window.addEventListener("popstate", (e) => {
  const pm = window.location.pathname.match(/^\/(space\/)?post\/(\d+)$/);
  if (pm) {
    showDetail(parseInt(pm[2]));
  } else {
    showList();
    const feed = document.getElementById("feed");
    if (feed && feed.children.length === 0) loadPosts();
  }
});

// ========== 超管：用户管理 ==========
async function showAdminPanel() {
  // 隐藏列表
  document.getElementById("feed").style.display = "none";
  const loadMoreDiv = document.getElementById("loadMore");
  if (loadMoreDiv) loadMoreDiv.style.display = "none";
  const pagination = document.getElementById("pagination");
  if (pagination) pagination.style.display = "none";
  const fab = document.getElementById("fab");
  if (fab) fab.style.display = "none";

  let detailView = document.getElementById("detailView");
  if (!detailView) {
    detailView = document.createElement("div");
    detailView.id = "detailView";
    const feed = document.getElementById("feed");
    feed.parentNode.insertBefore(detailView, feed.nextSibling);
  }
  detailView.style.display = "";

  try {
    const res = await fetch("/api/users", {
      headers: { "Authorization": "Bearer " + currentUser.token }
    });
    if (!res.ok) throw new Error("无权限");
    const users = await res.json();

    let rows = users.map(u => `
      <div class="admin-user-card">
        <div class="admin-user-info">
          <img src="${escapeHtml(u.avatar || '/default-avatar.png')}" class="admin-avatar">
          <div class="admin-user-detail">
            <div class="admin-user-name">${escapeHtml(u.nickname)}</div>
            <div class="admin-user-username">@${escapeHtml(u.username)}</div>
          </div>
          <span class="role-badge role-${u.role}">${u.role === 'superadmin' ? '超管' : u.role === 'admin' ? '管理员' : '游客'}</span>
        </div>
        ${u.role !== 'superadmin' ? `<div class="admin-user-actions">
          ${u.role === 'guest' ? `<button class="btn btn-primary btn-sm" onclick="setRole(${u.id}, 'admin')">设为管理员</button>` : ''}
          ${u.role === 'admin' ? `<button class="btn btn-secondary btn-sm" onclick="setRole(${u.id}, 'guest')">取消管理员</button>` : ''}
          <button class="btn btn-sm btn-danger" onclick="deleteUser(${u.id})" data-nickname="${escapeHtml(u.nickname)}">删除</button>
          <button class="btn btn-sm btn-warn" onclick="genResetCode(${u.id})">校验码</button>
          <span id="rc-${u.id}" class="reset-code-display"></span>
        </div>` : ''}
      </div>
    `).join("");

    // 获取邀请码
    let inviteHtml = "";
    try {
      const invRes = await fetch("/api/invite-code", { headers: { "Authorization": "Bearer " + currentUser.token } });
      if (invRes.ok) {
        const inv = await invRes.json();
        inviteHtml = `<div class="card" style="margin-bottom:16px;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px">
          <div><span style="color:var(--muted)">\u4eca\u65e5\u9080\u8bf7\u7801:</span> <strong style="font-size:1.2em;letter-spacing:2px;color:var(--primary)">${inv.code}</strong></div>
          <button class="btn btn-secondary btn-sm" onclick="refreshInviteCode()">\u5237\u65b0\u9080\u8bf7\u7801</button>
        </div>`;
      }
    } catch(e) {}

    detailView.innerHTML = `
      <a href="javascript:void(0)" onclick="backToList()" class="back-link">← 返回</a>
      ${inviteHtml}
      <div class="card" style="overflow-x:auto">
        <h3 style="margin-bottom:16px">用户管理</h3>
        <div class="admin-user-list">${rows}</div>
      </div>
    `;

    viewMode = "admin";
  } catch (err) { showToast(err.message); }
}

async function setRole(userId, role) {
  try {
    const res = await fetch(`/api/users/${userId}/role`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", "Authorization": "Bearer " + currentUser.token },
      body: JSON.stringify({ role })
    });
    if (!res.ok) { const err = await res.json(); throw new Error(err.error); }
    showToast("已更新");
    showAdminPanel();
  } catch (err) { showToast(err.message); }
}


async function genResetCode(userId) {
  try {
    const getRes = await fetch(`/api/users/${userId}/reset-code`, {
      headers: { "Authorization": "Bearer " + currentUser.token }
    });
    if (getRes.ok) {
      const data = await getRes.json();
      if (data.code) {
        document.getElementById("rc-" + userId).textContent = data.code;
        return;
      }
    }
    const res = await fetch(`/api/users/${userId}/reset-code`, {
      method: "POST",
      headers: { "Authorization": "Bearer " + currentUser.token }
    });
    if (!res.ok) { const err = await res.json(); throw new Error(err.error); }
    const result = await res.json();
    document.getElementById("rc-" + userId).textContent = result.code;
    showToast("校验码已生成");
  } catch (err) { showToast(err.message); }
}

async function refreshInviteCode() {
  try {
    const res = await fetch("/api/invite-code/refresh", {
      method: "POST",
      headers: { "Authorization": "Bearer " + currentUser.token }
    });
    if (!res.ok) { const err = await res.json(); throw new Error(err.error); }
    showToast("\u9080\u8bf7\u7801\u5df2\u5237\u65b0");
    showAdminPanel();
  } catch (err) { showToast(err.message); }
}

async function deleteUser(userId) {
  const btn = event.target.closest("[data-nickname]");
  const nickname = btn ? btn.dataset.nickname : "该用户";
  if (!confirm(`确定要删除用户「${nickname}」吗？\n\n该操作将删除该用户的所有动态和数据！`)) return;
  if (!confirm(`再次确认：真的要删除「${nickname}」吗？\n\n此操作不可撤销！`)) return;
  const input = prompt(`最后确认：请输入该用户昵称「${nickname}」以确认删除：`);
  if (input !== nickname) { showToast("输入不匹配，已取消删除"); return; }

  try {
    const res = await fetch(`/api/users/${userId}`, {
      method: "DELETE",
      headers: { "Authorization": "Bearer " + currentUser.token }
    });
    if (!res.ok) { const err = await res.json(); throw new Error(err.error); }
    showToast("用户已删除");
    showAdminPanel();
  } catch (err) { showToast(err.message); }
}

// ========== 修改个人信息 ==========
function showProfile() {
  document.getElementById("profileAvatar").src = currentUser.avatar || "/default-avatar.png";
  document.getElementById("profileModal").classList.add("show");
  document.getElementById("profileNickname").value = currentUser.nickname;
}

function closeProfile() {
  document.getElementById("profileModal").classList.remove("show");
}

async function saveProfile() {
  const nickname = document.getElementById("profileNickname").value.trim();
  const avatarInput = document.getElementById("profileAvatarInput");
  const newPwd = document.getElementById("profileNewPwd").value.trim();

  if (!nickname) { showToast("昵称不能为空"); return; }

  try {
    // 更新昵称和头像
    const formData = new FormData();
    formData.append("nickname", nickname);
    if (avatarInput.files && avatarInput.files[0]) formData.append("avatar", avatarInput.files[0]);

    const res = await fetch("/api/me", {
      method: "PUT",
      headers: { "Authorization": "Bearer " + currentUser.token },
      body: formData
    });
    if (!res.ok) { const err = await res.json(); throw new Error(err.error); }
    const updated = await res.json();
    currentUser.nickname = updated.nickname;
    currentUser.avatar = updated.avatar;

    // 修改密码（如果填了）
    if (newPwd) {
      if (newPwd.length < 4) { showToast("密码至少4位"); return; }
      const pwdRes = await fetch("/api/change-password-direct", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": "Bearer " + currentUser.token },
        body: JSON.stringify({ newPassword: newPwd })
      });
      if (!pwdRes.ok) { const err = await pwdRes.json(); throw new Error(err.error); }
    }

    updateUI();
    closeProfile();
    showToast("已更新");
  } catch (err) { showToast(err.message); }
}

// ========== 图片预览 ==========
function previewImages(input) {
  const container = document.getElementById("imagesPreview");
  const countEl = document.getElementById("imgCount");
  container.innerHTML = "";
  const files = input.files;
  if (!files.length) { countEl.textContent = ""; return; }
  countEl.textContent = "(" + files.length + "/9)";
  Array.from(files).slice(0, 9).forEach((file, i) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const wrap = document.createElement("div");
      wrap.className = "img-preview-item";
      wrap.innerHTML = `<img src="${e.target.result}"><button class="remove-img" onclick="removeOneImage(${i})">✕</button>`;
      container.appendChild(wrap);
    };
    reader.readAsDataURL(file);
  });
}

function removeOneImage(index) {
  const input = document.getElementById("postImages");
  const dt = new DataTransfer();
  Array.from(input.files).forEach((f, i) => { if (i !== index) dt.items.add(f); });
  input.files = dt.files;
  previewImages(input);
}

function clearImages() {
  const input = document.getElementById("postImages");
  if (input) input.value = "";
  const container = document.getElementById("imagesPreview");
  if (container) container.innerHTML = "";
  const countEl = document.getElementById("imgCount");
  if (countEl) countEl.textContent = "";
}

// ========== 工具函数 ==========
function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

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
  if (y === now.getFullYear()) return `${m}-${d} ${h}:${min}`;
  return `${y}-${m}-${d} ${h}:${min}`;
}

function showToast(msg) {
  const t = document.getElementById("toast");
  t.textContent = msg;
  t.classList.add("show");
  setTimeout(() => t.classList.remove("show"), 2500);
}


async function resetPassword() {
  const username = document.getElementById("resetUsername").value.trim();
  const code = document.getElementById("resetCode").value.trim();
  const newPwd = document.getElementById("resetNewPwd").value.trim();
  if (!username || !code || !newPwd) { showToast("请填写完整"); return; }
  try {
    const res = await fetch("/api/reset-password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, code, newPassword: newPwd })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    showToast("密码已重置，请登录");
    closeResetModal();
  } catch (err) { showToast(err.message); }
}

function showResetModal() {
  document.getElementById("resetModal").classList.add("show");
}

function closeResetModal() {
  document.getElementById("resetModal").classList.remove("show");
  document.getElementById("resetUsername").value = "";
  document.getElementById("resetCode").value = "";
  document.getElementById("resetNewPwd").value = "";
}


function renderReplyItem(c, postId) {
  const canDelete = currentUser && (currentUser.id === c.user_id || currentUser.role === "superadmin" || currentUser.role === "admin");
  const deleteBtn = canDelete ? `<button class="comment-delete" onclick="deleteComment(${c.id}, ${postId})">删除</button>` : "";
  const replyBtn = currentUser ? `<button class="comment-reply-btn" onclick="setReply(${c.id}, '${escapeHtml(c.nickname || "匿名").replace(/'/g, "\\'")}', ${postId})">回复</button>` : "";
  const replyTag = c.reply_to_nickname ? `<span class="comment-reply-tag">回复 @${escapeHtml(c.reply_to_nickname)}</span>` : "";
  return `<div class="reply-item">
    <img src="${escapeHtml(c.avatar || '/default-avatar.png')}" class="reply-avatar">
    <div class="reply-body">
      <div class="reply-header">
        <span class="reply-author">${escapeHtml(c.nickname || '匿名')}</span>
        ${replyTag}
        <span class="reply-time">${formatTime(c.created_at)}</span>
        ${replyBtn}
        ${deleteBtn}
      </div>
      <div class="reply-text">${escapeHtml(c.content)}</div>
    </div>
  </div>`;
}

function renderComment(c, postId) {
  const canDelete = currentUser && (currentUser.id === c.user_id || currentUser.role === "superadmin" || currentUser.role === "admin");
  const deleteBtn = canDelete ? `<button class="comment-delete" onclick="deleteComment(${c.id}, ${postId})">删除</button>` : "";
  const replyBtn = currentUser ? `<button class="comment-reply-btn" onclick="setReply(${c.id}, '${escapeHtml(c.nickname || "匿名").replace(/'/g, "\\'")}', ${postId})">回复</button>` : "";
  const allReplies = flattenReplies(c);
  const repliesHtml = allReplies.length ? `<div class="reply-list">${allReplies.map(r => renderReplyItem(r, postId)).join("")}</div>` : "";
  return `<div class="comment-card">
    <div class="comment-main">
      <img src="${escapeHtml(c.avatar || '/default-avatar.png')}" class="comment-avatar">
      <div class="comment-body">
        <div class="comment-header">
          <span class="comment-author">${escapeHtml(c.nickname || '匿名')}</span>
          <span class="comment-time">${formatTime(c.created_at)}</span>
          ${replyBtn}
          ${deleteBtn}
        </div>
        <div class="comment-text">${escapeHtml(c.content)}</div>
      </div>
    </div>
    ${repliesHtml}
  </div>`;
}

function flattenReplies(node) {
  const result = [];
  if (!node.children) return result;
  for (const child of node.children) {
    result.push(child);
    result.push(...flattenReplies(child));
  }
  return result;
}

function buildCommentTree(comments) {
  const map = {};
  const roots = [];
  comments.forEach(c => { c.children = []; map[c.id] = c; });
  comments.forEach(c => {
    if (c.parent_id && map[c.parent_id]) {
      map[c.parent_id].children.push(c);
    } else {
      roots.push(c);
    }
  });
  return roots;
}

async function loadComments(postId) {
  try {
    const res = await fetch(`/api/posts/${postId}/comments`);
    const comments = await res.json();
    const list = document.getElementById("commentList");
    if (!comments.length) {
      list.innerHTML = '<div class="comment-empty">暂无评论，来说点什么吧 ✨</div>';
      return;
    }
    const tree = buildCommentTree(comments);
    list.innerHTML = tree.map(c => renderComment(c, postId)).join("");
  } catch (err) {
    document.getElementById("commentList").innerHTML = '<div style="color:#ef4444;padding:20px;text-align:center">加载评论失败</div>';
  }
}

let replyToCommentId = null;

function setReply(commentId, nickname, postId) {
  replyToCommentId = commentId;
  const hint = document.getElementById("replyHint");
  const hintText = document.getElementById("replyHintText");
  if (hint && hintText) {
    hintText.textContent = "回复 " + nickname;
    hint.style.display = "flex";
  }
  const input = document.getElementById("commentInput");
  if (input) { input.placeholder = "回复 " + nickname + "..."; input.focus(); }
}

function cancelReply() {
  replyToCommentId = null;
  const hint = document.getElementById("replyHint");
  if (hint) hint.style.display = "none";
  const input = document.getElementById("commentInput");
  if (input) input.placeholder = "写评论...";
}

async function submitComment(postId) {
  const input = document.getElementById("commentInput");
  const content = input.value.trim();
  if (!content) return;
  try {
    const body = { content };
    if (replyToCommentId) body.parent_id = replyToCommentId;
    const res = await fetch(`/api/posts/${postId}/comments`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": "Bearer " + currentUser.token },
      body: JSON.stringify(body)
    });
    if (!res.ok) { const err = await res.json(); throw new Error(err.error); }
    input.value = "";
    cancelReply();
    loadComments(postId);
    showToast("评论成功");
  } catch (err) { showToast(err.message); }
}

async function deleteComment(commentId, postId) {
  if (!confirm("确定删除这条评论？")) return;
  try {
    const res = await fetch(`/api/comments/${commentId}`, {
      method: "DELETE",
      headers: { "Authorization": "Bearer " + currentUser.token }
    });
    if (!res.ok) { const err = await res.json(); throw new Error(err.error); }
    loadComments(postId);
    showToast("评论已删除");
  } catch (err) { showToast(err.message); }
}

// ========== 访客记录 ==========

// 上报访问
function reportVisit() {
  const headers = {};
  if (currentUser) headers["Authorization"] = "Bearer " + currentUser.token;
  fetch("/api/visit", { method: "POST", headers }).catch(() => {});
}

// 超管：加载访客列表
async function loadVisitors() {
  if (!currentUser || currentUser.role !== "superadmin") return;
  try {
    const res = await fetch("/api/visitors?limit=30", {
      headers: { "Authorization": "Bearer " + currentUser.token }
    });
    const visitors = await res.json();
    const panel = document.getElementById("visitorPanel");
    if (!panel) return;
    panel.style.display = "block";

    const list = document.getElementById("visitorList");
    if (!visitors.length) {
      list.innerHTML = '<div style="text-align:center;padding:16px;color:var(--text-secondary);font-size:0.85rem">暂无访客记录</div>';
      return;
    }

    list.innerHTML = visitors.map(v => {
      const time = formatTime(v.visited_at);
      if (v.user_id && v.nickname) {
        const avatar = v.avatar || '/default-avatar.png';
        return `<div class="visitor-item">
          <img src="${escapeHtml(avatar)}" class="visitor-avatar">
          <div class="visitor-info">
            <span class="visitor-name">${escapeHtml(v.nickname)}</span>
            <span class="visitor-time">${time}</span>
          </div>
        </div>`;
      } else {
        return `<div class="visitor-item">
          <div class="visitor-ip-icon">👤</div>
          <div class="visitor-info">
            <span class="visitor-name visitor-ip">${escapeHtml(v.ip || '未知')}</span>
            <span class="visitor-time">${time}</span>
          </div>
        </div>`;
      }
    }).join("");
  } catch (err) {}
}

// ========== 通知 ==========
async function loadNotifications() {
  if (!currentUser) return;
  try {
    const res = await fetch("/api/notifications/unread-count", {
      headers: { "Authorization": "Bearer " + currentUser.token }
    });
    const data = await res.json();
    const badge = document.getElementById("notifBadge");
    if (badge) {
      badge.textContent = data.count > 0 ? data.count : "";
      badge.style.display = data.count > 0 ? "inline-block" : "none";
    }
  } catch (err) {}
}

async function showNotifications() {
  const modal = document.getElementById("notifModal");
  modal.classList.add("show");
  const list = document.getElementById("notifList");
  list.innerHTML = '<div style="text-align:center;padding:30px;color:var(--text-secondary)">加载中...</div>';

  try {
    // 标记全部已读
    await fetch("/api/notifications/read-all", {
      method: "POST",
      headers: { "Authorization": "Bearer " + currentUser.token }
    });
    loadNotifications();

    const res = await fetch("/api/notifications", {
      headers: { "Authorization": "Bearer " + currentUser.token }
    });
    const notifs = await res.json();
    if (!notifs.length) {
      list.innerHTML = '<div class="comment-empty">暂无通知 🔔</div>';
      return;
    }
    list.innerHTML = notifs.map(n => {
      const icon = n.type === "like" ? "❤️" : "💬";
      const text = n.type === "like" ? "赞了你的动态" : `评论了你的动态: ${escapeHtml((n.content || "").slice(0, 50))}`;
      const readClass = n.is_read ? " read" : "";
      return `<div class="notif-item${readClass}" onclick="closeNotifModal();${n.post_id ? 'showDetail(' + n.post_id + ')' : ''}">
        <img src="${escapeHtml(n.from_avatar || '/default-avatar.png')}" class="notif-avatar">
        <div class="notif-body">
          <div class="notif-text"><strong>${escapeHtml(n.from_nickname || '系统')}</strong> ${icon} ${text}</div>
          <div class="notif-time">${formatTime(n.created_at)}</div>
        </div>
      </div>`;
    }).join("");
  } catch (err) {
    list.innerHTML = '<div style="color:#ef4444;padding:30px;text-align:center">加载失败</div>';
  }
}

function closeNotifModal() {
  document.getElementById("notifModal").classList.remove("show");
}

function previewProfileAvatar(input) {
  if (input.files && input.files[0]) {
    const reader = new FileReader();
    reader.onload = (e) => {
      document.getElementById("profileAvatar").src = e.target.result;
    };
    reader.readAsDataURL(input.files[0]);
  }
}

function closeAdminPanel() {
  document.getElementById("adminModal").classList.remove("show");
}

function confirmLogout() {
  if (confirm("确定要退出登录吗？")) {
    closeProfile();
    doLogout();
  }
}


// ========== 公告 ==========
function showAnnouncements() {
  const main = document.querySelector(".main-content") || document.querySelector(".detail-wrap") || document.body;
  // Hide feed and other content
  const feed = document.getElementById("feed");
  const publishArea = document.getElementById("publishArea");
  const loadMore = document.getElementById("loadMore");
  const emptyState = document.getElementById("emptyState");
  const searchDrawer = document.getElementById("searchDrawer");
  if (feed) feed.style.display = "none";
  if (publishArea) publishArea.style.display = "none";
  if (loadMore) loadMore.style.display = "none";
  if (emptyState) emptyState.style.display = "none";
  if (searchDrawer) searchDrawer.classList.remove("open");

  let container = document.getElementById("announcementView");
  if (!container) {
    container = document.createElement("div");
    container.id = "announcementView";
    container.className = "announcement-view";
    if (feed) feed.parentNode.insertBefore(container, feed);
    else document.body.appendChild(container);
  }
  container.style.display = "block";
  container.innerHTML = '<div style="text-align:center;padding:40px;color:var(--text-secondary)">加载中...</div>';
  loadAnnouncements();
}

function hideAnnouncements() {
  const container = document.getElementById("announcementView");
  if (container) container.style.display = "none";
  const feed = document.getElementById("feed");
  const publishArea = document.getElementById("publishArea");
  const loadMore = document.getElementById("loadMore");
  if (feed) feed.style.display = "";
  if (publishArea && currentUser && (currentUser.role === "admin" || currentUser.role === "superadmin")) publishArea.style.display = "block";
  if (loadMore) loadMore.style.display = "";
}

async function loadAnnouncements() {
  const container = document.getElementById("announcementView");
  if (!container) return;
  try {
    const res = await fetch("/api/announcements");
    const data = await res.json();

    let publishBtn = "";
    if (currentUser && currentUser.role === "superadmin") {
      publishBtn = `<button class="btn btn-primary btn-sm" onclick="showPublishAnnouncement()" style="margin-left:auto">发布公告</button>`;
    }

    let listHtml = "";
    if (!data.announcements.length) {
      listHtml = '<div class="announce-empty"><svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="display:block;margin:0 auto 8px;opacity:0.4"><rect width="16" height="13" x="6" y="4" rx="2"/><path d="m22 7-7.1 3.78c-.57.3-1.23.3-1.8 0L6 7"/><path d="M2 8v11a2 2 0 0 0 2 2h16"/></svg>暂无公告</div>';
    } else {
      listHtml = data.announcements.map(a => {
        const pinTag = a.pinned ? '<span class="announce-pin"><svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block;vertical-align:-2px"><path d="M12 17v5"/><path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z"/></svg> 置顶</span>' : "";
        const actions = currentUser && currentUser.role === "superadmin" ? `
          <div class="announce-actions">
            <button class="btn-text" onclick="togglePinAnnouncement(${a.id})">${a.pinned ? "取消置顶" : "置顶"}</button>
            <button class="btn-text btn-danger" onclick="deleteAnnouncement(${a.id})">删除</button>
          </div>` : "";
        return `<div class="announce-card${a.pinned ? ' announce-pinned' : ''}" onclick="showAnnouncementDetail(${a.id})">
          <div class="announce-card-header">
            ${pinTag}
            <h3 class="announce-title">${escapeHtml(a.title)}</h3>
          </div>
          <div class="announce-preview">${escapeHtml(a.content.slice(0, 100))}${a.content.length > 100 ? '...' : ''}</div>
          <div class="announce-meta">
            <span>${escapeHtml(a.author_name || '管理员')}</span>
            <span>${formatTime(a.created_at)}</span>
          </div>
          ${actions}
        </div>`;
      }).join("");
    }

    container.innerHTML = `
      <div class="announce-header">
        <button class="back-btn" onclick="hideAnnouncements()">← 返回</button>
        <h2><svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block;vertical-align:-3px"><path d="m3 11 18-5v12L3 13v-2z"/><path d="M11.6 16.8a3 3 0 1 1-5.8-1.6"/></svg> 公告</h2>
        ${publishBtn}
      </div>
      <div class="announce-list">${listHtml}</div>
    `;
  } catch (err) {
    container.innerHTML = '<div style="color:#ef4444;text-align:center;padding:40px">加载公告失败</div>';
  }
}

async function showAnnouncementDetail(id) {
  const container = document.getElementById("announcementView");
  if (!container) return;
  try {
    const res = await fetch(`/api/announcements/${id}`);
    const a = await res.json();
    container.innerHTML = `
      <div class="announce-header">
        <button class="back-btn" onclick="loadAnnouncements()">← 返回列表</button>
      </div>
      <div class="announce-detail-card">
        ${a.pinned ? '<span class="announce-pin"><svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block;vertical-align:-2px"><path d="M12 17v5"/><path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z"/></svg> 置顶</span>' : ''}
        <h2 class="announce-detail-title">${escapeHtml(a.title)}</h2>
        <div class="announce-detail-meta">
          <span>${escapeHtml(a.author_name || '管理员')}</span>
          <span>${formatTime(a.created_at)}</span>
        </div>
        <div class="announce-detail-content">${escapeHtml(a.content).replace(/\n/g, '<br>')}</div>
      </div>
    `;
  } catch (err) {
    showToast("加载失败");
  }
}

function showPublishAnnouncement() {
  const container = document.getElementById("announcementView");
  if (!container) return;
  container.innerHTML = `
    <div class="announce-header">
      <button class="back-btn" onclick="loadAnnouncements()">← 返回列表</button>
      <h2>发布公告</h2>
    </div>
    <div class="announce-form">
      <input type="text" id="announceTitle" placeholder="公告标题" maxlength="100" class="announce-input">
      <textarea id="announceContent" placeholder="公告内容..." maxlength="5000" rows="8" class="announce-textarea"></textarea>
      <label class="announce-pin-label"><input type="checkbox" id="announcePinned"> 置顶</label>
      <button class="btn btn-primary" onclick="submitAnnouncement()">发布</button>
    </div>
  `;
}

async function submitAnnouncement() {
  const title = document.getElementById("announceTitle").value.trim();
  const content = document.getElementById("announceContent").value.trim();
  const pinned = document.getElementById("announcePinned").checked;
  if (!title) return showToast("请输入标题");
  if (!content) return showToast("请输入内容");
  try {
    const res = await fetch("/api/announcements", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": "Bearer " + currentUser.token },
      body: JSON.stringify({ title, content, pinned })
    });
    if (!res.ok) { const err = await res.json(); throw new Error(err.error); }
    showToast("公告发布成功");
    loadAnnouncements();
  } catch (err) { showToast(err.message); }
}

async function deleteAnnouncement(id) {
  event.stopPropagation();
  if (!confirm("确定删除这条公告？")) return;
  try {
    const res = await fetch(`/api/announcements/${id}`, {
      method: "DELETE",
      headers: { "Authorization": "Bearer " + currentUser.token }
    });
    if (!res.ok) { const err = await res.json(); throw new Error(err.error); }
    showToast("公告已删除");
    loadAnnouncements();
  } catch (err) { showToast(err.message); }
}

async function togglePinAnnouncement(id) {
  event.stopPropagation();
  try {
    const res = await fetch(`/api/announcements/${id}/pin`, {
      method: "PATCH",
      headers: { "Authorization": "Bearer " + currentUser.token }
    });
    if (!res.ok) { const err = await res.json(); throw new Error(err.error); }
    loadAnnouncements();
  } catch (err) { showToast(err.message); }
}
