---
title: 本地开发
description: 使用 pnpm 启动本地前端，连接远端或本地后端
---

# 本地开发

只调试前端时，在仓库根目录启动开发服务，业务接口通过现有 `/api/*` 代理连接远端后端，无需在本机启动 Go 或数据库。

## 连接远端后端

准备 Node.js 和 pnpm，项目固定使用 pnpm `11.9.0`。工作区仅包含 `web`，首次在仓库根目录执行：

```bash
pnpm install
cp web/.env.example web/.env.development.local
pnpm dev
```

已有 `web/.env.development.local` 时不要覆盖，只补充或修改这一项：

```dotenv
API_BASE_URL=https://aigc.juxplay.com
```

访问 `http://localhost:3000`，以后在仓库根目录直接执行 `pnpm dev`。开发服务沿用 Webpack 和 `3000` 端口，支持前端热更新。

- `API_BASE_URL` 填后端站点根地址，不带 `/api`；修改后重启开发服务。
- 浏览器请求 localhost 的 `/api/*`，由 Next.js 服务端转发到远端。这个变量只供服务端使用，无需 `NEXT_PUBLIC_` 前缀。
- Next.js 从 `web` 加载前端环境配置；根目录 `.env` 供 Go 和 Docker 使用。本地开发配置已被 Git 忽略，终端设置的同名环境变量优先。
- localhost 需要使用已有远端账号单独登录。登录且账号同步可用时，画布、素材和配置会读写该远端账号的数据；未登录时画布项目和“我的素材”保存在当前浏览器本地。
- AI 直连渠道继续使用界面中的渠道配置，API Key 保存在浏览器本地，并由前端直接请求对应接口。

Docker 和 CI 继续沿用现有 Bun 安装与构建流程，保留 `web/bun.lock`；pnpm 锁文件用于本地工作区安装。

## 同时调试本地后端

需要修改 Go 代码时，在仓库根目录准备后端配置并启动：

```bash
cp .env.example .env
go run .
```

已有 `.env` 时沿用现有文件。默认后端监听 `8080`，SQLite 数据库位于 `data/infinite-canvas.db`。

在另一个终端的仓库根目录启动前端，临时覆盖远端配置：

```bash
API_BASE_URL=http://127.0.0.1:8080 pnpm dev
```

也可以将该地址写入 `web/.env.development.local` 后重新执行 `pnpm dev`。未设置 `API_BASE_URL` 时，现有代理默认连接 `http://127.0.0.1:8080`。

## 手动验收

- 打开首页和画布，确认页面、静态资源及修改后的热更新正常。
- 访问 `http://localhost:3000/api/health`，应返回 `ok`；业务请求在浏览器中保持 localhost 同源。
- 登录后检查用户配置、画布读取、素材加载和文件上传，并验证视频 Range 请求与流式响应。
- 后端不可达时，代理应返回 `502` 和现有接口连接失败提示。

以上运行验收由开发者执行。
