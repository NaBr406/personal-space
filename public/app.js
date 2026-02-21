// ========== 状态管理 ==========
let isAdmin = false;        // 是否已登录管理员
let adminPassword = '';     // 管理员密码（仅存于内存）
let currentPage = 1;        // 当前页码
let totalPages = 1;         // 总页数
let loading = false;        // 是否正在加载

// ========== DOM 元素 ==========
const feed = document.getElementById('feed');
const publishArea = document.getElementById('publishArea');
const authModal = document.getElementById('authModal');
const btnLogin = document.getElementById('btnLogin');
const loadMoreDiv = document.getElementById('loadMore');
const emptyState = document.getElementById('emptyState');
const toast = document.getElementById('toast');

// ========== 初始化 ==========
document.addEventListener('DOMContentLoaded', () => {
  // 检查 sessionStorage 中是否有已保存的登录态
  const saved = sessionStorage.getItem('admin_password');
  if (saved) {
    adminPassword = saved;
    verifyPassword(saved).then(ok => {
      if (ok) setAdminMode(true);
    });
  }
  loadPosts();
});

// ========== 认证相关 ==========

// 切换登录弹窗 / 退出登录
function toggleAuth() {
  if (isAdmin) {
    // 退出登录
    setAdminMode(false);
    adminPassword = '';
    sessionStorage.removeItem('admin_password');
    showToast('已退出管理模式');
    return;
  }
  authModal.classList.add('show');
  document.getElementById('passwordInput').focus();
}

function closeAuth() {
  authModal.classList.remove('show');
  document.getElementById('passwordInput').value = '';
}

// 执行登录
async function doLogin() {
  const pwd = document.getElementById('passwordInput').value.trim();
  if (!pwd) {
    showToast('请输入密码');
    return;
  }
  const ok = await verifyPassword(pwd);
  if (ok) {
    adminPassword = pwd;
    sessionStorage.setItem('admin_password', pwd);
    setAdminMode(true);
    closeAuth();
    showToast('登录成功 ✨');
  } else {
    showToast('密码错误');
  }
}

// 向后端验证密码
async function verifyPassword(pwd) {
  try {
    const res = await fetch('/api/auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: pwd })
    });
    return res.ok;
  } catch {
    return false;
  }
}

// 设置管理员模式
function setAdminMode(on) {
  isAdmin = on;
  publishArea.style.display = on ? 'block' : 'none';
  btnLogin.textContent = on ? '🔓 退出' : '🔑 管理';
  btnLogin.classList.toggle('active', on);
  // 重新渲染动态（显示/隐藏删除按钮）
  currentPage = 1;
  feed.innerHTML = '';
  loadPosts();
}

// ========== 动态加载 ==========

async function loadPosts() {
  if (loading) return;
  loading = true;

  try {
    const res = await fetch(`/api/posts?page=${currentPage}&limit=10`);
    const data = await res.json();

    if (currentPage === 1 && data.posts.length === 0) {
      emptyState.style.display = 'block';
      loadMoreDiv.style.display = 'none';
    } else {
      emptyState.style.display = 'none';
      data.posts.forEach(post => {
        feed.appendChild(createPostCard(post));
      });
      totalPages = data.pagination.pages;
      loadMoreDiv.style.display = currentPage < totalPages ? 'block' : 'none';
      currentPage++;
    }
  } catch (err) {
    showToast('加载失败: ' + err.message);
  } finally {
    loading = false;
  }
}

// 创建动态卡片 DOM
function createPostCard(post) {
  const card = document.createElement('div');
  card.className = 'card post-card';
  card.dataset.id = post.id;

  let imageHtml = '';
  if (post.image) {
    imageHtml = `
      <div class="post-image">
        <img src="${escapeHtml(post.image)}" alt="动态图片" loading="lazy" onclick="window.open(this.src)">
      </div>`;
  }

  let deleteBtn = '';
  if (isAdmin) {
    deleteBtn = `<button class="btn-delete" onclick="deletePost(${post.id})">🗑 删除</button>`;
  }

  card.innerHTML = `
    <div class="post-content">${escapeHtml(post.content)}</div>
    ${imageHtml}
    <div class="post-footer">
      <span class="post-time">${formatTime(post.created_at)}</span>
      ${deleteBtn}
    </div>
  `;

  return card;
}

// ========== 发布动态 ==========

async function submitPost() {
  const content = document.getElementById('postContent').value.trim();
  const imageInput = document.getElementById('postImage');

  if (!content) {
    showToast('请输入内容');
    return;
  }

  const formData = new FormData();
  formData.append('content', content);
  formData.append('password', adminPassword);
  if (imageInput.files[0]) {
    formData.append('image', imageInput.files[0]);
  }

  try {
    const res = await fetch('/api/posts', {
      method: 'POST',
      body: formData
    });

    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error);
    }

    const post = await res.json();

    // 清空输入
    document.getElementById('postContent').value = '';
    removeImage();

    // 将新动态插入到列表顶部
    const firstChild = feed.firstChild;
    const card = createPostCard(post);
    if (firstChild) {
      feed.insertBefore(card, firstChild);
    } else {
      feed.appendChild(card);
      emptyState.style.display = 'none';
    }

    showToast('发布成功 🎉');
  } catch (err) {
    showToast('发布失败: ' + err.message);
  }
}

// ========== 删除动态 ==========

async function deletePost(id) {
  if (!confirm('确定要删除这条动态吗？')) return;

  try {
    const res = await fetch(`/api/posts/${id}`, {
      method: 'DELETE',
      headers: {
        'Content-Type': 'application/json',
        'X-Admin-Password': adminPassword
      }
    });

    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error);
    }

    // 从 DOM 中移除
    const card = document.querySelector(`.post-card[data-id="${id}"]`);
    if (card) {
      card.style.opacity = '0';
      card.style.transform = 'translateY(-10px)';
      setTimeout(() => card.remove(), 300);
    }

    showToast('已删除');
  } catch (err) {
    showToast('删除失败: ' + err.message);
  }
}

// ========== 图片预览 ==========

function previewImage(input) {
  const file = input.files[0];
  if (!file) return;

  // 检查文件大小
  if (file.size > 5 * 1024 * 1024) {
    showToast('图片不能超过 5MB');
    input.value = '';
    return;
  }

  const reader = new FileReader();
  reader.onload = (e) => {
    document.getElementById('previewImg').src = e.target.result;
    document.getElementById('imagePreview').style.display = 'inline-block';
  };
  reader.readAsDataURL(file);
}

function removeImage() {
  document.getElementById('postImage').value = '';
  document.getElementById('imagePreview').style.display = 'none';
  document.getElementById('previewImg').src = '';
}

// ========== 工具函数 ==========

// HTML 转义，防止 XSS
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// 格式化时间显示
function formatTime(dateStr) {
  const date = new Date(dateStr);
  const now = new Date();
  const diff = (now - date) / 1000; // 秒

  if (diff < 60) return '刚刚';
  if (diff < 3600) return Math.floor(diff / 60) + ' 分钟前';
  if (diff < 86400) return Math.floor(diff / 3600) + ' 小时前';
  if (diff < 604800) return Math.floor(diff / 86400) + ' 天前';

  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  const h = String(date.getHours()).padStart(2, '0');
  const min = String(date.getMinutes()).padStart(2, '0');

  if (y === now.getFullYear()) return `${m}-${d} ${h}:${min}`;
  return `${y}-${m}-${d} ${h}:${min}`;
}

// 显示提示消息
function showToast(msg) {
  toast.textContent = msg;
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), 2500);
}
