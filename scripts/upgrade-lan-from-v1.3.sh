#!/usr/bin/env bash
set -Eeuo pipefail

VERSION="${1:-v1.4.0}"
ROOT="${LABEQUIP_ROOT:-/opt/cipc-labequip}"
CURRENT="$ROOT/current"
DATA_FILE="/var/lib/cipc-labequip/data/production.sqlite"
BACKUP_DIR="/var/lib/cipc-labequip/backups"
SERVICE_USER="cipc-labequip"
API_SERVICE="cipc-labequip-api.service"
COMPOSE_FILE="$ROOT/compose.yaml"
PREVIOUS_COMMIT=""

case "$VERSION" in v[0-9]*.[0-9]*.[0-9]*) ;; *) echo "用法：sudo bash scripts/upgrade-lan-from-v1.3.sh [v1.4.0]" >&2; exit 2 ;; esac
[ -d "$CURRENT/.git" ] || { echo "找不到 Git 工作目录：$CURRENT" >&2; exit 1; }
cd "$CURRENT"
[ -z "$(git status --porcelain)" ] || { echo "当前代码目录有未提交修改，请先处理：$CURRENT" >&2; exit 1; }
git fetch --tags origin
 git rev-parse --verify "refs/tags/$VERSION" >/dev/null
PREVIOUS_COMMIT=$(git rev-parse HEAD)

sudo install -d -o "$SERVICE_USER" -g "$SERVICE_USER" "$BACKUP_DIR"
sudo -u "$SERVICE_USER" /usr/bin/node scripts/backup-db.mjs --data "$DATA_FILE" --output-dir "$BACKUP_DIR" --keep 14
sudo systemctl stop "$API_SERVICE"
sudo docker compose -f "$COMPOSE_FILE" stop web
trap 'git switch --detach "$PREVIOUS_COMMIT" >/dev/null 2>&1 || true; sudo systemctl start "$API_SERVICE" || true; sudo docker compose -f "$COMPOSE_FILE" up -d --no-deps --force-recreate web || true' ERR

git switch --detach "$VERSION"
/usr/bin/pnpm install --frozen-lockfile
/usr/bin/node --test apps/api/test/*.test.mjs apps/web/test/*.test.mjs scripts/test/*.test.mjs
sudo install -m 0644 deploy/lan/cipc-labequip-api.service /etc/systemd/system/cipc-labequip-api.service
sudo install -m 0644 deploy/lan/cipc-labequip-upgrade.service /etc/systemd/system/cipc-labequip-upgrade.service
sudo install -m 0644 deploy/lan/cipc-labequip-upgrade.path /etc/systemd/system/cipc-labequip-upgrade.path
sudo install -d -o "$SERVICE_USER" -g "$SERVICE_USER" /var/lib/cipc-labequip/data/upgrade
sudo systemctl daemon-reload
sudo systemctl enable --now cipc-labequip-upgrade.path
sudo systemctl start "$API_SERVICE"
sudo docker compose -f "$COMPOSE_FILE" up -d --no-deps --force-recreate web
curl -fsS http://127.0.0.1:4000/api/health
curl -fsS http://127.0.0.1:8080/api/health
trap - ERR
echo "升级完成：$VERSION"
echo "上一版本提交：$PREVIOUS_COMMIT"
echo "升级中心已启用：成员与权限 → 系统升级"
