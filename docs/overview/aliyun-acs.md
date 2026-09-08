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

## 当前部署记录

- 应用已部署到 `aigc` 命名空间，正式入口为 `https://aigc.juxplay.com`；默认关闭公开注册，管理员可在后台创建团队账号。
- 当前发布参数见 `deploy/acs/release.env`。镜像由 Actions 工作流 `34202448616` 构建，amd64、arm64 均通过，GHCR 可见性为 private。
- 数据卷：`d-t4n6ouqfqt26vatvyx9i`，20 GiB ESSD PL1，挂载设备 `/dev/vdb`，PV 回收策略为 Retain。
- 新 HTTPS 监听：`lsn-06vyo5hzcuaxt9c9rp`，已读取确认请求和空闲超时均为 300 秒。新 Host 路由优先级为 1，HTTP 返回 308 跳转；原 80 监听和原网站路由保留。
- ECS 运维目录：`/opt/aigc-deploy`。`acme` 保存证书账户和续期配置，`tls` 保存证书，`reload-tls.sh` 更新 TLS Secret；`/etc/cron.d/aigc-acme` 每日执行续期检查。
- `renew-kubeconfig` 使用 `tls-renewer` ServiceAccount，只能读取和更新 `aigc-tls`；已验证不能读取 `aigc-secrets`。DNS RAM 凭证只允许查询域名及管理 `juxplay.com` 的解析记录。
- SLS 项目内新增 `aigc-stdout`、`aigc-ai-calls` 两个 Logstore，各 1 个分片、保留 7 天；配置见 `deploy/acs/logging.yaml`。
- Prometheus 已启用 `aigc-unavailable`、`aigc-restarts`、`aigc-memory-high`、`aigc-data-disk-high`，实际规则保存在 `deploy/acs/alerts.json`。磁盘规则使用已核实的 `/dev/vdb` 容量指标；更改挂载结构后应复核设备标签。
- 管理员、数据库、JWT、OSS 和 DNS 凭据保存在部署电脑的 `~/.config/aigc-deploy/credentials.json`，权限为 0600，不在仓库中。

## 已完成验收

- 首页、画布、登录、管理入口及页面引用的静态资源正常，Chrome 可打开画布；未登录画布的文本节点刷新后保留。
- 管理员与普通账号登录正常；较大画布及超过 64 KiB 的图片历史、素材 JSON 保存后，由独立登录会话完整读回。数据库实际字段类型为 LONGTEXT。
- OSS 图片、视频、音频及中文文件名上传下载正常；Range 请求返回 206、正确的 Content-Range 和对应字节；容量统计、删除、密钥脱敏及留空保存沿用通过。
- Seedance 参考素材返回正式 HTTPS 地址且可公开读取；Pod 重建后，画布、OSS 媒体和参考素材均仍可读取。
- 本项目数据库和数据卷已导出到 ECS 的 `backups` 目录，记录镜像和 SHA256；重建采用 Recreate，期间存在短暂 503，恢复后新 Pod 为 1/1、重启次数为 0。
- 原 `app.juxplay.com`、`admin.juxplay.com` 的 HTTP 响应状态、长度和内容摘要与部署前一致。
- 标准输出及独立验收文件日志已实际进入对应 SLS Logstore；TLS Secret 更新脚本及 acme.sh 续期检查已执行。业务验收使用的临时账号、云端素材及文件日志样本已清理。

代码准备阶段没有运行本地构建或测试；编译由 Actions 完成，上述检查针对部署环境执行。

运维备份使用 `deploy/acs/backup.sh`，在 ECS 上导入临时运维 KUBECONFIG 后执行。数据库凭据位于权限为 0600 的 `/opt/aigc-deploy/mysql.cnf`。备份仅包含本项目数据，位于 `/opt/aigc-deploy/backups`，包含 SQL、数据目录归档、资源清单、镜像摘要和校验值。TLS 续期专用凭据没有执行备份或修改应用的权限。

## 待完成的外部配置与人工验收

- GHCR 当前使用已获授权的 GitHub CLI 凭证，包含 `read:packages` 和原有 `repo` 等权限。需替换为只包含 `read:packages` 的专用 classic token；将其保存到部署电脑的 `~/.config/aigc-deploy/ghcr-read-token` 后再更新 `ghcr-pull`。
- RDS API 创建的普通账号已经只授予 `aigc` 业务库，但 ReadWrite 模板还附带全局 PROCESS、复制权限及系统表查询权限。精确最小权限尚未完成；用现有 RDS 高权限账号执行 `deploy/acs/database-grants.sql`，或提供受限的 `~/.config/aigc-deploy/mysql-admin.cnf` 后执行。不要重置共享实例已有账号的密码。
- 当前没有模型渠道。真实聊天流、图片生成、视频任务轮询及模型侧拉取参考素材尚未验收，需在后台配置已有渠道后继续。
- 现有告警中心没有通知策略。四条告警规则已启用，但邮件、钉钉等接收人尚未配置，不能视为通知链路已经通过。
- 独立登录会话的同步 API 已通过；第二台真实设备的浏览器同步和视频拖动播放仍需人工确认。备份文件已生成，尚未进行独立恢复演练。
