# Personal Space 个人空间

一个轻量、可自部署的个人空间项目。

它把 **动态 / 博客 / 公告 / 用户系统 / 通知** 放在同一个应用里，技术栈尽量简单：**Node.js + Express + SQLite + 原生前端**，不依赖 MySQL、Redis，也不需要前后端分离框架，适合个人站、练手项目或小规模自用部署。

## 功能特性

- **动态广场**：发布文字与多图动态，支持详情页与浏览量统计
- **互动系统**：点赞、评论、回复、通知
- **博客 / 文章**：支持独立文章页与轻量内容页
- **公告系统**：管理员发布、置顶、删除公告
- **账号系统**：注册、登录、登出、多设备 session
- **权限管理**：超管 / 管理员 / 游客
- **邀请码机制**：每日自动生成，支持后台刷新
- **密码重置**：通过校验码重置密码
- **图片上传**：本地存储、缩略图生成、上传目录管理
- **用户资料**：头像上传、昵称等基础资料管理
- **主题与适配**：亮暗主题、移动端适配

## 技术栈

- **后端**：Node.js + Express
- **数据库**：SQLite（better-sqlite3）
- **图片处理**：Sharp
- **上传**：Multer
- **鉴权**：Bearer Token + bcryptjs
- **前端**：HTML / CSS / JavaScript（无前端框架）

## 适合什么场景

- 想做一个自己的个人空间 / 说说站 / 朋友圈式站点
- 想练习 Node.js 全栈基础能力
- 想快速部署一个不依赖外部数据库的小型 Web 应用
- 想在一套项目里练账号系统、上传、权限、公告、通知这些常见模块

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

默认监听端口：`3000`

浏览器访问：

```text
http://localhost:3000
```

首次启动时会自动初始化 SQLite 数据库文件。

## 配置说明

当前项目配置集中在 `config/index.js`。

### 环境变量

| 变量名 | 默认值 | 说明 |
|---|---:|---|
| `PORT` | `3000` | 服务端口 |
| `NODE_ENV` | `production` / `sandbox` | 运行环境，影响默认端口判断 |
| `APP_ENV` | 跟随 `NODE_ENV` | 应用环境名称 |

### 端口规则

- 默认正式环境：`3000`
- `NODE_ENV=sandbox` 时默认：`3001`

## 项目结构

```text
personal-space/
├── server.js                 # 应用入口
├── ecosystem.config.js       # PM2 启动配置
├── package.json
├── data.db                   # SQLite 数据库文件（运行后生成/使用）
├── config/
│   └── index.js              # 路径、端口、环境配置
├── db/
│   └── index.js              # 数据库初始化与表结构
├── middleware/
│   └── auth.js               # 登录态 / 权限中间件
├── routes/
│   ├── auth.js               # 注册、登录、重置密码等
│   ├── users.js              # 用户资料、头像、管理功能
│   ├── social.js             # 动态、评论、点赞、通知等
│   └── articles.js           # 博客 / 文章相关接口
├── services/
│   └── uploads.js            # 上传与缩略图处理
└── public/
    ├── index.html            # 个人空间首页 / 动态页
    ├── detail.html           # 动态详情页
    ├── blog.html             # 博客页
    ├── chitchat.html         # 轻量内容页
    ├── announcements.html    # 公告页
    ├── app.js                # 前端主逻辑
    ├── article.js            # 文章页脚本
    ├── style.css             # 全局样式
    ├── theme.js              # 主题切换
    ├── default-avatar.png    # 默认头像
    ├── default-avatar.svg
    └── uploads/              # 用户上传文件目录
```

## 运行方式

### 本地直接运行

```bash
npm start
```

### 使用 PM2

项目已提供 `ecosystem.config.js`，可直接使用：

```bash
pm2 start ecosystem.config.js
pm2 status
```

其中预设了两套应用：

- `personal-space`：正式环境，端口 `3000`
- `personal-space-sandbox`：沙盒环境，端口 `3001`

## 部署建议

推荐结构：

- Node.js 应用运行在本机端口（如 `3000` / `3001`）
- 使用 Nginx 反向代理到外部域名
- 静态上传文件保存在 `public/uploads/`
- SQLite 数据库保存在项目根目录 `data.db`

如果你希望把它挂到某个子路径下（例如 `/space/`），建议在反向代理层处理路径转发。

## 开发说明

这个项目当前是 **偏实用、偏一体化** 的结构：

- 后端接口集中在 `server.js + routes/*`
- 前端是原生页面配合脚本
- 数据层用 SQLite，部署和迁移成本低

如果后续继续扩展，比较适合优先做这些拆分：

- 继续把 `server.js` 中的接口拆到 `routes/`
- 把数据库查询逐步沉到独立 service / model 层
- 把前端脚本按页面或模块继续拆分
- 给上传、通知、文章这些功能补更明确的服务边界

## License

MIT
