// ========== 状态管理 ==========
let currentUser = null;
let currentPage = 1;
let totalPages = 1;
let loading = false;
let searchStart = "";
let searchEnd = "";
let viewMode = "list"; // list | detail | admin

// ========== 初始化 ==========
document.addEventListener("DOMContentLoaded", () => {
  const token = localStorage.getItem("token");
  if (token) {
    fetchMe(token).then(user => {
      if (user) {
        currentUser = user;
        currentUser.token = token;
        updateUI();
      }
    });
  }
  updateUI();
  loadPosts();
});

// ========== 认证 ==========
async function fetchMe(token) {
  try {
    const res = await fetch("/api/me", { headers: { "Authorization": "Bearer " + token } });
    if (!res.ok) { localStorage.removeItem("token"); return null; }
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
  document.getElementById("authSwitch").innerHTML = mode === "login"
    ? '没有账号？<a href="javascript:void(0)" onclick="showAuthModal(\'register\')">去注册</a>'
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
    closeAuthModal();
    updateUI();
    currentPage = 1;
    document.getElementById("feed").innerHTML = "";
    loadPosts();
    showToast("欢迎回来，" + data.nickname + "");
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
      body: JSON.stringify({ username, password, nickname, captchaToken, captchaAnswer })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);

    currentUser = data;
    localStorage.setItem("token", data.token);
    closeAuthModal();
    updateUI();
    showToast("注册成功，欢迎 " + data.nickname + "");
  } catch (err) { showToast(err.message); }
}

function doLogout() {
  currentUser = null;
  localStorage.removeItem("token");
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

    const res = await fetch(url);
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
  let imageHtml = post.image ? `<div class="post-image"><img src="${escapeHtml(post.thumbnail || post.image)}" alt="图片" loading="lazy" onclick="recordView(${post.id}); window.open('${escapeHtml(post.image)}')"></div>` : "";

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
    btn.querySelector("span").textContent = data.like_count;
  } catch (err) { showToast(err.message); }
}

// ========== 发布动态 ==========
async function submitPost() {
  const content = document.getElementById("postContent").value.trim();
  const imageInput = document.getElementById("postImage");

  if (!content && !imageInput.files[0]) {
    showToast("请输入内容或选择图片");
    return;
  }

  const formData = new FormData();
  if (content) formData.append("content", content);
  if (imageInput.files[0]) formData.append("image", imageInput.files[0]);

  try {
    const res = await fetch("/api/posts", {
      method: "POST",
      headers: { "Authorization": "Bearer " + currentUser.token },
      body: formData
    });
    if (!res.ok) { const err = await res.json(); throw new Error(err.error); }

    const post = await res.json();
    document.getElementById("postContent").value = "";
    removeImage();

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
async function showDetail(id) {
  const feed = document.getElementById("feed");
  const loadMoreDiv = document.getElementById("loadMore");

  feed.style.transition = "opacity 0.2s ease, transform 0.2s ease";
  feed.style.opacity = "0";
  feed.style.transform = "translateY(8px)";
  loadMoreDiv.style.display = "none";

  await new Promise(r => setTimeout(r, 200));

  fetch(`/api/posts/${id}/view`, { method: "POST" }).catch(() => {});

  try {
    const res = await fetch(`/api/posts/${id}`);
    if (!res.ok) throw new Error("动态不存在");
    const post = await res.json();

    let authorHtml = "";
    if (post.author_name) {
      authorHtml = `<div class="post-author"><img src="${escapeHtml(post.author_avatar || '/default-avatar.png')}" class="author-avatar"><span>${escapeHtml(post.author_name)}</span></div>`;
    }
    let contentHtml = post.content ? `<div class="post-content" style="font-size:1.05rem;line-height:1.9">${escapeHtml(post.content)}</div>` : "";
    let imageHtml = post.image ? `<div class="post-image"><img src="${escapeHtml(post.thumbnail || post.image)}" style="max-height:600px;object-fit:contain" onclick="recordView(${post.id}); window.open('${escapeHtml(post.image)}')"></div>` : "";

    const liked = post.liked ? "liked" : "";
    const likeBtn = `<button class="btn-like ${liked}" onclick="toggleLike(${post.id}, this)"><svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block;vertical-align:-2px"><path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"/></svg> <span>${post.like_count || 0}</span></button>`;

    feed.innerHTML = `
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

    feed.style.transform = "translateY(8px)";
    feed.style.opacity = "0";
    requestAnimationFrame(() => {
      feed.style.transition = "opacity 0.25s ease, transform 0.25s ease";
      feed.style.opacity = "1";
      feed.style.transform = "translateY(0)";
    });

    history.pushState({ detail: id }, "", "/post/" + id);
    document.title = (post.content ? post.content.slice(0, 30) : "图片动态") + " - 我的空间";
    viewMode = "detail";
  } catch (err) {
    feed.innerHTML = `<div style="text-align:center;padding:60px;color:#ef4444">😢 ${err.message}</div>`;
    feed.style.opacity = "1";
    feed.style.transform = "translateY(0)";
  }
}

function backToList() {
  const feed = document.getElementById("feed");
  feed.style.transition = "opacity 0.2s ease, transform 0.2s ease";
  feed.style.opacity = "0";
  feed.style.transform = "translateY(8px)";
  setTimeout(() => {
    feed.innerHTML = "";
    feed.style.opacity = "1";
    feed.style.transform = "translateY(0)";
    currentPage = 1;
    loadPosts();
    history.pushState(null, "", "/");
    document.title = "我的空间";
    viewMode = "list";
  }, 200);
}

window.addEventListener("popstate", (e) => {
  if (e.state && e.state.detail) {
    showDetail(e.state.detail);
  } else {
    const feed = document.getElementById("feed");
    feed.innerHTML = "";
    currentPage = 1;
    loadPosts();
    document.title = "我的空间";
    viewMode = "list";
  }
});

// ========== 超管：用户管理 ==========
async function showAdminPanel() {
  const feed = document.getElementById("feed");
  const loadMoreDiv = document.getElementById("loadMore");
  loadMoreDiv.style.display = "none";

  feed.style.transition = "opacity 0.2s ease";
  feed.style.opacity = "0";
  await new Promise(r => setTimeout(r, 200));

  try {
    const res = await fetch("/api/users", {
      headers: { "Authorization": "Bearer " + currentUser.token }
    });
    if (!res.ok) throw new Error("无权限");
    const users = await res.json();

    let rows = users.map(u => `
      <tr>
        <td><img src="${escapeHtml(u.avatar || '/default-avatar.png')}" class="admin-avatar"></td>
        <td>${escapeHtml(u.nickname)}</td>
        <td>${escapeHtml(u.username)}</td>
        <td><span class="role-badge role-${u.role}">${u.role === 'superadmin' ? '超管' : u.role === 'admin' ? '管理员' : '游客'}</span></td>
        <td>
          ${u.role === 'guest' ? `<button class="btn btn-primary btn-sm" onclick="setRole(${u.id}, 'admin')">设为管理员</button>` : ''}
          ${u.role === 'admin' ? `<button class="btn btn-secondary btn-sm" onclick="setRole(${u.id}, 'guest')">取消管理员</button>` : ''}
          ${u.role !== 'superadmin' ? `<button class="btn btn-sm" style="background:#ef4444;color:#fff;margin-left:4px" onclick="deleteUser(${u.id}, '${u.nickname.replace(/'/g, "\\'")}')">删除</button>` : ''}
        </td>
      </tr>
    `).join("");

    feed.innerHTML = `
      <a href="javascript:void(0)" onclick="backToList()" class="back-link">← 返回</a>
      <div class="card" style="overflow-x:auto">
        <h3 style="margin-bottom:16px">用户管理</h3>
        <table class="admin-table">
          <thead><tr><th>头像</th><th>昵称</th><th>用户名</th><th>角色</th><th>操作</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    `;

    feed.style.opacity = "1";
    viewMode = "admin";
  } catch (err) { showToast(err.message); feed.style.opacity = "1"; }
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

async function deleteUser(userId, nickname) {
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
function previewImage(input) {
  const file = input.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (e) => {
    document.getElementById("previewImg").src = e.target.result;
    document.getElementById("imagePreview").style.display = "inline-block";
  };
  reader.readAsDataURL(file);
}

function removeImage() {
  document.getElementById("postImage").value = "";
  document.getElementById("imagePreview").style.display = "none";
  document.getElementById("previewImg").src = "";
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
