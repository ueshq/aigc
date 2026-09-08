---
title: 阿里云 ACS 部署
description: 新加坡 ACS、RDS MySQL 和 OSS 的项目独立部署
---

# 阿里云 ACS 部署

站点使用 `https://aigc.juxplay.com`。在新加坡 `juxta` 集群内使用独立 `aigc` 命名空间，复用现有 ALB、VPC、NAT 和 RDS 实例。应用是单副本 Next.js + Go 容器，1 核、2 GiB，通过 3000 端口提供页面及 API。

## 数据与配置

- RDS：使用独立 `aigc` 库及 `aigc_app` 普通账号，通过内网连接。GORM 自动建表；同步 JSON 字段使用数据库方言默认长文本类型，避免 MySQL TEXT 的 64 KiB 限制。
- OSS：项目私有桶 `aigc-sg-5401181278881324`，后台选择“阿里云 OSS”，Region 填 `ap-southeast-1`，Endpoint 填 `https://oss-ap-southeast-1-internal.aliyuncs.com`。使用仅授权本桶的 RAM 凭据，公开访问域名留空，媒体由站点文件接口读取。
- OSS 使用官方 Go SDK v2，支持上传、流式及 Range 下载、删除、分页容量统计；只接受该地域的官方 HTTPS Endpoint。首期仅提供后台统一 OSS 配置。
- `/app/data` 挂载独立 20 GiB ESSD PL1 云盘，保留参考素材及 AI 调用日志。卷回收策略为 Retain。
- 未登录的画布和“我的素材”仍保存在浏览器本地；登录且同步可用时才同步到账号。模型密钥按所选渠道的现有规则保存，用户自定义直连渠道的 Key 保存在浏览器本地。

## 发布

1. 通过 `intl-singapore` 配置操作云资源。集群 API 仅开放内网，从同 VPC 的 ECS 运维入口操作，先保存现有 AlbConfig、Ingress 及本项目部署配置。
2. 使用仓库 Docker image 工作流构建镜像，记录完整 digest。镜像保持私有，给 `aigc/ghcr-pull` 配置具备 `read:packages` 的拉取凭据。
3. 根据 `deploy/acs/secrets.env.example` 在仓库外生成受限配置文件，将其导入 `aigc/aigc-secrets`；密钥不得进入 Git、镜像或命令输出。
4. 将 `deploy/acs/app.yaml` 的 `__AIGC_IMAGE__` 替换为 `ghcr.io/ueshq/aigc@sha256:实际摘要` 后应用。不要使用 latest。等待 `/api/health` 和数据库初始化成功。
5. 配置管理员统一 OSS，并确认站点上传下载。复用原 `alb` IngressClass；在原 AlbConfig 增加 HTTPS 443 监听，保留 HTTP 80，新增监听的请求及空闲超时设为 300 秒。
6. ECS 使用 acme.sh 的阿里云 DNS-01 签发并自动续期 `aigc.juxplay.com`，通过受限 Kubernetes 凭据更新 `aigc-tls`。应用 `deploy/acs/ingress.yaml`，再配置 `aigc` CNAME 指向原 ALB。
7. 验证 HTTPS、原应用路由、画布同步、媒体 Range 下载、Pod 重建后的文件持久性。模型渠道及真实生成效果需按实际渠道验收。

## 更新与恢复

更新前停止提交新生成请求，等待当前任务完成；单副本 Recreate 更新允许短暂停机。记录旧镜像 digest，备份本项目数据库和数据卷。回退只恢复本项目的镜像及对应数据，不恢复整个共享 RDS，也不覆盖其他应用资源。

复用现有 SLS，应用日志保留 7 天；监控应用可用性、Pod 重启、内存和数据卷容量，卷使用率超过 80% 告警。定期确认 TLS 自动续期任务及备份可恢复。

当前 RDS 有公网地址且原白名单包含全网地址。新应用只使用内网；收紧共享实例公网权限需另行确认现有业务依赖。
