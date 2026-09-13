---
title: TODO
description: 当前项目后续值得处理的事项
---

# TODO

本文档用来记录当前项目后续比较值得处理的事项。

- MiniMax 2K 重生成：官方开通白名单后评估改用 `source_task_id`，免去成片公网地址和重传原素材，并覆盖从账号任务列表恢复、缺少原素材的历史记录。

- ACS 收尾：将 GHCR 临时部署凭证替换为仅含 `read:packages` 的专用凭证；使用 RDS 高权限账号执行本项目最小权限 SQL；配置告警通知接收人。实际部署与待办边界见 [部署说明](../overview/aliyun-acs.md)。
