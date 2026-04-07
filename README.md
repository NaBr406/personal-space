# Personal Space 个人空间

一个轻量、可自部署的个人空间项目，定位是 **动态 + 博客 + 公告 + 用户系统 + 通知** 的一体化站点。

这份仓库是 **Node.js / Express 原版实现**：后端接口、SQLite 数据库、上传处理、原生前端页面都在同一个项目里，适合直接部署，也适合作为练手项目阅读和二次改造。

## 这项目能做什么

- **动态广场**：发布文字与多图动态，支持详情页与浏览量统计
- **互动系统**：点赞、评论、回复、通知
- **博客 / 文章**：支持 `blog` / `chitchat` 两类内容
- **公告系统**：超管发布、删除、置顶公告
- **账号系统**：注册、登录、登出、多设备 session
- **权限管理**：`superadmin` / `admin` / `guest`
- **邀请码机制**：每日自动生成邀请码，支持后台刷新
- **密码重置**：超管生成校验码，用户通过校验码重置密码
- **图片上传**：头像、动态多图、文章封面、本地存储、缩略图生成
- **访客记录**：记录访问并提供超管查看接口
- **前端页面**：主页、动态详情、博客页、轻量内容页、公告页、亮暗主题、移动端适配

## 技术栈

- **后端**：Node.js + Express
- **数据库**：SQLite（better-sqlite3）
- **鉴权**：Bearer Token + session 表
- **密码处理**：bcryptjs
- **上传**：multer
- **图片处理**：sharp
- **前端**：HTML / CSS / JavaScript（无框架）

## 适合什么场景

- 想做一个自己的个人空间 / 说说站 / 小型社区站
- 想练 Node.js 全栈基础能力
- 想快速部署一个不依赖 MySQL、Redis 的小站
- 想在一个项目里练账号系统、上传、权限、公告、通知这些常见模块

## 快速开始

### 1. 克隆项目

```bash
git clone https://github.com/NaBr406/personal-space.git
cd personal-space
```

### 2. 安装依赖

```bash
npm install
```

### 3. 启动项目

```bash
npm start
```

默认端口：`3000`

启动后访问：

```text
http://127.0.0.1:3000
```

首次启动时会自动初始化 SQLite 数据库和上传目录。

## 常用脚本

```bash
npm start
npm run dev
```

> 当前 `dev` 也是直接跑 `node server.js`，如果你想接 `nodemon`，可以自己再补。

## 环境变量

项目配置集中在 `config/index.js`，当前支持的环境变量不多，主要是端口和环境名：

| 变量名 | 默认值 | 说明 |
| --- | --- | --- |
| `PORT` | `3000` | 服务端口 |
| `NODE_ENV` | `production` | 运行环境 |
| `APP_ENV` | 跟随 `NODE_ENV` | 应用环境名 |

### 端口规则

- 正式环境默认：`3000`
- 当 `NODE_ENV=sandbox` 时默认：`3001`

示例：

```bash
PORT=3001 NODE_ENV=sandbox npm start
```

## 项目结构

```text
personal-space/
├── server.js                 # 应用入口
├── ecosystem.config.js       # PM2 配置
├── package.json
├── config/
│   └── index.js              # 端口、目录、环境配置
├── db/
│   └── index.js              # SQLite 初始化与表结构
├── middleware/
│   └── auth.js               # 登录态 / 权限中间件
├── routes/
│   ├── auth.js               # 注册、登录、验证码
│   ├── users.js              # 用户资料、权限、邀请码、重置密码
│   ├── social.js             # 动态、评论、点赞、通知
│   └── articles.js           # 博客 / 文章相关接口
├── services/
│   └── uploads.js            # 上传与缩略图处理
└── public/
    ├── index.html            # 主页面 / 动态页
    ├── detail.html           # 动态详情页
    ├── blog.html             # 博客页
    ├── chitchat.html         # 轻量内容页
    ├── announcements.html    # 公告页
    ├── app.js                # 主页面脚本
    ├── article.js            # 博客 / chitchat 脚本
    ├── style.css             # 样式
    ├── theme.js              # 主题切换
    └── uploads/              # 上传目录
```

## API 概览

### 基础与认证

- `GET /api/captcha`
- `POST /api/register`
- `POST /api/login`
- `POST /api/logout`
- `GET /api/me`

### 用户与管理

- `PUT /api/me`
- `POST /api/change-password`
- `POST /api/change-password-direct`
- `GET /api/users`
- `PUT /api/users/:id/role`
- `DELETE /api/users/:id`
- `GET /api/invite-code`
- `POST /api/invite-code/refresh`
- `POST /api/users/:id/reset-code`
- `GET /api/users/:id/reset-code`
- `POST /api/reset-password`
- `POST /api/visit`
- `GET /api/visitors`

### 动态 / 评论 / 通知

- `GET /api/posts`
- `GET /api/posts/:id`
- `POST /api/posts`
- `DELETE /api/posts/:id`
- `POST /api/posts/:id/view`
- `POST /api/posts/:id/like`
- `GET /api/posts/:id/comments`
- `POST /api/posts/:id/comments`
- `DELETE /api/comments/:id`
- `GET /api/notifications`
- `GET /api/notifications/unread-count`
- `POST /api/notifications/read-all`
- `POST /api/notifications/:id/read`
- `POST /api/upload-image`

### 文章 / 公告

- `GET /api/articles`
- `GET /api/articles/:id`
- `POST /api/articles/:id/view`
- `POST /api/articles`
- `PUT /api/articles/:id`
- `DELETE /api/articles/:id`
- `GET /api/announcements`
- `GET /api/announcements/:id`
- `POST /api/announcements`
- `DELETE /api/announcements/:id`
- `PATCH /api/announcements/:id/pin`

## 上传与媒体说明

- 动态支持 `multipart/form-data`，字段名：`images`，最多 9 张
- 头像更新通过 `PUT /api/me` 上传字段 `avatar`
- 文章封面通过 `POST/PUT /api/articles` 上传字段 `cover`
- 上传文件保存在 `public/uploads/`
- 动态会额外生成缩略图，供卡片列表使用
- 删除帖子 / 用户 / 文章时，会尽量清理相关文件

## 运行方式

### 本地直接运行

```bash
npm start
```

### 使用 PM2

项目自带 `ecosystem.config.js`：

```bash
pm2 start ecosystem.config.js
pm2 status
```

默认包含两套应用：

- `personal-space`：正式环境，端口 `3000`
- `personal-space-sandbox`：沙盒环境，端口 `3001`

## 部署建议

推荐结构：

- Node.js 应用监听本机端口（如 `3000` / `3001`）
- Nginx 反向代理到外部域名
- 上传文件保存在 `public/uploads/`
- SQLite 数据库保存在项目根目录 `data.db`

如果你希望挂到子路径（例如 `/space/`），建议在反向代理层处理路径转发。

## 这个仓库和 Java 版是什么关系

如果你正在看 Java 迁移版，可以同时参考：

- **Java 后端迁移仓库**：`personal-space-java-backend`

Node 版更像是：

- 当前完整参考实现
- 前端行为的基准版本
- 部署最直接的一体化版本

Java 版则更适合继续往结构化后端方向演进。

## 后续可以继续改的方向

- 给开发模式接 `nodemon`
- 拆更细的 service / model 层
- 补测试
- 把前端脚本进一步模块化
- 把权限、通知、上传做得更清晰

## License

MIT
