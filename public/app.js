// ========== 状态管理 ==========
let isAdmin = false;
let adminPassword = "";
let currentPage = 1;
let totalPages = 1;
let loading = false;
let searchStart = "";
let searchEnd = "";

// ========== DOM 元素 ==========
const feed = document.getElementById("feed");
const publishArea = document.getElementById("publishArea");
const authModal = document.getElementById("authModal");
const btnLogin = document.getElementById("btnLogin");
const loadMoreDiv = document.getElementById("loadMore");
const emptyState = document.getElementById("emptyState");
const toast = document.getElementById("toast");

// ========== 初始化 ==========
document.addEventListener("DOMContentLoaded", () => {
  const saved = sessionStorage.getItem("admin_password");
  if (saved) {
    adminPassword = saved;
    verifyPassword(saved).then(ok => {
      if (ok) setAdminMode(true);
    });
  }
  loadPosts();
});

// ========== 认证相关 ==========
function toggleAuth() {
  if (isAdmin) {
    setAdminMode(false);
    adminPassword = "";
    sessionStorage.removeItem("admin_password");
    showToast("已退出管理模式");
    return;
  }
  authModal.classList.add("show");
  document.getElementById("passwordInput").focus();
}

function closeAuth() {
  authModal.classList.remove("show");
  document.getElementById("passwordInput").value = "";
}

async function doLogin() {
  const pwd = document.getElementById("passwordInput").value.trim();
  if (!pwd) { showToast("请输入密码"); return; }
  const ok = await verifyPassword(pwd);
  if (ok) {
    adminPassword = pwd;
    sessionStorage.setItem("admin_password", pwd);
    setAdminMode(true);
    closeAuth();
    showToast("登录成功 ✨");
  } else {
    showToast("密码错误");
  }
}

async function verifyPassword(pwd) {
  try {
    const res = await fetch("/api/auth", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: pwd })
    });
    return res.ok;
  } catch { return false; }
}

function setAdminMode(on) {
  isAdmin = on;
  publishArea.style.display = on ? "block" : "none";
  btnLogin.textContent = on ? "🔓 退出" : "🔑 管理";
  btnLogin.classList.toggle("active", on);
  document.getElementById("btnChangePwd").style.display = on ? "" : "none";
  currentPage = 1;
  feed.innerHTML = "";
  loadPosts();
}

// ========== 时间查找 ==========
function toggleSearch() {
  const drawer = document.getElementById("searchDrawer");
  const btn = document.querySelector(".btn-icon");
  drawer.classList.toggle("open");
  btn.classList.toggle("active");
}

function doSearch() {
  const start = document.getElementById("searchStart").value;
  const end = document.getElementById("searchEnd").value;
  searchStart = start;
  searchEnd = end;
  currentPage = 1;
  feed.innerHTML = "";
  loadPosts();
}

function clearSearch() {
  document.getElementById("searchStart").value = "";
  document.getElementById("searchEnd").value = "";
  searchStart = "";
  searchEnd = "";
  currentPage = 1;
  feed.innerHTML = "";
  loadPosts();
}

// ========== 动态加载 ==========
async function loadPosts() {
  if (loading) return;
  loading = true;

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
        // 记录浏览次数
        recordView(post.id);
      });
      totalPages = data.pagination.pages;
      loadMoreDiv.style.display = currentPage < totalPages ? "block" : "none";
      currentPage++;
    }
  } catch (err) {
    showToast("加载失败: " + err.message);
  } finally {
    loading = false;
  }
}

// 记录浏览次数
function recordView(postId) {
  fetch(`/api/posts/${postId}/view`, { method: "POST" }).catch(() => {});
}

// 创建动态卡片
function createPostCard(post) {
  const card = document.createElement("div");
  card.className = "card post-card";
  card.dataset.id = post.id;

  let contentHtml = "";
  if (post.content) {
    contentHtml = `<div class="post-content">${escapeHtml(post.content)}</div>`;
  }

  let imageHtml = "";
  if (post.image) {
    imageHtml = `
      <div class="post-image">
        <img src="${escapeHtml(post.image)}" alt="动态图片" loading="lazy" onclick="window.open(this.src)">
      </div>`;
  }

  let deleteBtn = "";
  if (isAdmin) {
    deleteBtn = `<button class="btn-delete" onclick="deletePost(${post.id})">🗑 删除</button>`;
  }

  const views = post.views || 0;

  card.innerHTML = `
    ${contentHtml}
    ${imageHtml}
    <div class="post-footer">
      <span class="post-time">${formatTime(post.created_at)}</span>
      <span class="post-views">👁 ${views}</span>
      ${deleteBtn}
    </div>
  `;

  return card;
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
  formData.append("password", adminPassword);
  if (imageInput.files[0]) {
    formData.append("image", imageInput.files[0]);
  }

  try {
    const res = await fetch("/api/posts", {
      method: "POST",
      body: formData
    });

    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error);
    }

    const post = await res.json();
    document.getElementById("postContent").value = "";
    removeImage();

    const firstChild = feed.firstChild;
    const card = createPostCard(post);
    if (firstChild) {
      feed.insertBefore(card, firstChild);
    } else {
      feed.appendChild(card);
      emptyState.style.display = "none";
    }

    showToast("发布成功 🎉");
  } catch (err) {
    showToast("发布失败: " + err.message);
  }
}

// ========== 删除动态 ==========
async function deletePost(id) {
  if (!confirm("确定要删除这条动态吗？")) return;

  try {
    const res = await fetch(`/api/posts/${id}`, {
      method: "DELETE",
      headers: {
        "Content-Type": "application/json",
        "X-Admin-Password": adminPassword
      }
    });

    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error);
    }

    const card = document.querySelector(`.post-card[data-id="${id}"]`);
    if (card) {
      card.style.opacity = "0";
      card.style.transform = "translateY(-10px)";
      setTimeout(() => card.remove(), 300);
    }

    showToast("已删除");
  } catch (err) {
    showToast("删除失败: " + err.message);
  }
}

// ========== 图片预览 ==========
function previewImage(input) {
  const file = input.files[0];
  if (!file) return;

  if (file.size > 5 * 1024 * 1024) {
    showToast("图片不能超过 5MB");
    input.value = "";
    return;
  }

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
  toast.textContent = msg;
  toast.classList.add("show");
  setTimeout(() => toast.classList.remove("show"), 2500);
}


// ========== 修改密码 ==========
function openChangePwd() {
  document.getElementById("changePwdModal").classList.add("show");
  document.getElementById("oldPwdInput").value = "";
  document.getElementById("newPwdInput").value = "";
  document.getElementById("confirmPwdInput").value = "";
  document.getElementById("oldPwdInput").focus();
}

function closeChangePwd() {
  document.getElementById("changePwdModal").classList.remove("show");
}

async function doChangePwd() {
  const oldPwd = document.getElementById("oldPwdInput").value.trim();
  const newPwd = document.getElementById("newPwdInput").value.trim();
  const confirmPwd = document.getElementById("confirmPwdInput").value.trim();

  if (!oldPwd || !newPwd) {
    showToast("请填写完整");
    return;
  }
  if (newPwd !== confirmPwd) {
    showToast("两次密码不一致");
    return;
  }
  if (newPwd.length < 4) {
    showToast("新密码至少4位");
    return;
  }

  try {
    const res = await fetch("/api/change-password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ oldPassword: oldPwd, newPassword: newPwd })
    });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error);
    }
    // 更新内存中的密码
    adminPassword = newPwd;
    sessionStorage.setItem("admin_password", newPwd);
    closeChangePwd();
    showToast("密码修改成功 ✅");
  } catch (err) {
    showToast(err.message);
  }
}
