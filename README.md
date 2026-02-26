# Personal Space 个人空间

轻量级个人动态分享平台，类似朋友圈。纯 Node.js 实现，无需外部数据库。

## 预览

支持亮暗双主题，跟随系统设置自动切换。

## 功能

- **动态发布** — 文字 + 多图，支持拖拽上传
- **互动** — 点赞、评论、嵌套回复
- **通知** — 点赞/评论实时通知，未读计数
- **账号系统** — 注册(邀请码)、登录、多设备 session
- **用户管理** — 角色分级(超管/管理员/游客)、用户删除
- **公告系统** — 管理员发布公告，置顶/删除
- **密码重置** — 超管生成校验码，用户自助重置
- **邀请码** — 每日自动生成，超管可查看/刷新
- **图片处理** — 缩略图自动生成(WebP)、懒加载、灯箱查看
- **搜索** — 关键词 + 日期范围筛选
- **响应式** — 移动端完整适配
- **双主题** — 亮/暗色跟随系统 `prefers-color-scheme`

## 技术栈

- **后端** — Node.js + Express
- **数据库** — SQLite (better-sqlite3)
- **图片** — Sharp (WebP 缩略图)
- **认证** — bcryptjs + Bearer Token
- **前端** — 原生 HTML/CSS/JS，零框架依赖

## 部署

```bash
# 克隆
git clone https://github.com/NaBr406/personal-space.git
cd personal-space

# 安装依赖
npm install

# 启动
npm start
```

默认端口 `3000`，访问 `http://localhost:3000`。

首次启动自动创建数据库和超管账号 `NaBr406`。

## 目录结构

```
personal-space/
├── server.js              # 后端服务 + API
├── package.json
├── public/
│   ├── index.html         # 空间主页
│   ├── detail.html        # 动态详情页
│   ├── announcements.html # 公告页
│   ├── style.css          # 样式（亮暗双主题）
│   ├── app.js             # 前端逻辑
│   ├── default-avatar.png # 默认头像
│   └── uploads/           # 用户上传图片
└── data.db                # SQLite 数据库（自动生成）
```

## 配置

环境变量：

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `PORT` | `3000` | 服务端口 |

## License

MIT
