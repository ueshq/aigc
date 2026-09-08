#!/bin/sh
# 在 ECS 上执行；KUBECONFIG 指向本次运维的临时管理员凭据。
# 先等待生成任务完成，mysql.cnf 仅保存 aigc_app 的内网连接凭据。
set -eu
umask 077
K=/opt/aigc-deploy/kubectl
DEST=/opt/aigc-deploy/backups/$(date -u +%Y%m%dT%H%M%SZ)
mkdir -p "$DEST"
$K get deployment,pvc,service,ingress -n aigc -o yaml > "$DEST/resources.yaml"
$K get deployment aigc -n aigc -o jsonpath='{.spec.template.spec.containers[0].image}' > "$DEST/image.txt"
mysqldump --defaults-extra-file=/opt/aigc-deploy/mysql.cnf \
  --single-transaction --no-tablespaces --databases aigc > "$DEST/aigc.sql"
$K exec deployment/aigc -n aigc -- tar -C /app/data -czf - . > "$DEST/data.tar.gz"
test -s "$DEST/aigc.sql"
test -s "$DEST/data.tar.gz"
sha256sum "$DEST/aigc.sql" "$DEST/data.tar.gz" > "$DEST/SHA256SUMS"
printf 'Backup saved: %s\n' "$DEST"
