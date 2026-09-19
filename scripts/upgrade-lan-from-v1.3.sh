#!/usr/bin/env bash
set -Eeuo pipefail

# Bootstrap from a pinned source archive, never git-switch the live directory.
# Works for both a v1.3 Git checkout and later archive-only installations.
VERSION="${1:-v1.4.12}"
[[ "$VERSION" =~ ^v?(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$ ]] || { echo "用法：sudo bash upgrade-lan-from-v1.3.sh v1.4.12" >&2; exit 2; }
[ "$(id -u)" -eq 0 ] || { echo "请通过 sudo 运行升级入口" >&2; exit 1; }
NODE="${UPDATE_NODE:-$(command -v node)}"
[ -x "$NODE" ] || { echo "请设置 UPDATE_NODE 为 Node.js 22–24 的绝对路径" >&2; exit 1; }
WORK=$(mktemp -d /tmp/labequip-manual.XXXXXX)
trap 'rm -rf "$WORK"' EXIT

# Reuse site-local effective updater settings (including VPS health port 8020).
# Parse only an allowlist of Environment keys, with no shell eval/source.
UNIT_ENV=$(systemctl show cipc-labequip-upgrade.service --property=Environment --value 2>/dev/null || true)
"$NODE" --input-type=module - "$UNIT_ENV" > "$WORK/environment" <<'JS'
const allowed = new Set(["UPDATE_REPOSITORY", "UPDATE_BASE_DIR", "UPDATE_CURRENT_LINK", "UPDATE_RELEASES_DIR", "UPDATE_REQUEST_FILE", "UPDATE_STATUS_FILE", "UPDATE_SERVICE_USER", "UPDATE_SERVICE_GROUP", "UPDATE_API_SERVICE", "UPDATE_COMPOSE_FILE", "UPDATE_API_HEALTH_URL", "UPDATE_WEB_HEALTH_URL", "UPDATE_NODE", "DATA_FILE", "BACKUP_DIR"]);
const text = process.argv[2] || "";
for (const token of text.match(/"(?:[^"\\]|\\.)*"|[^\s]+/g) || []) {
  const value = token.startsWith('"') ? JSON.parse(token) : token;
  const key = value.slice(0, value.indexOf("="));
  if (!allowed.has(key)) continue;
  if (/[\r\n\0]/.test(value)) throw new Error("升级服务环境变量包含无效字符");
  console.log(value);
}
JS
while IFS= read -r assignment; do
  [ -n "$assignment" ] || continue
  key="${assignment%%=*}"
  if [ -z "${!key+x}" ]; then export "$assignment"; fi
done < "$WORK/environment"
NODE="${UPDATE_NODE:-$NODE}"
export UPDATE_NODE="$NODE"
export UPDATE_BASE_DIR="${UPDATE_BASE_DIR:-${LABEQUIP_ROOT:-/opt/cipc-labequip}}"
export UPDATE_REQUEST_FILE="${UPDATE_REQUEST_FILE:-/var/lib/cipc-labequip/data/upgrade/request.json}"
export UPDATE_REPOSITORY="${UPDATE_REPOSITORY:-fluter1604191276/CIPC-LabEquip-Hub-Public}"
[[ "$UPDATE_REPOSITORY" =~ ^[a-zA-Z0-9_.-]+/[a-zA-Z0-9_.-]+$ ]] || { echo "UPDATE_REPOSITORY 格式无效" >&2; exit 2; }

STATE_DIR="$(dirname "$UPDATE_REQUEST_FILE")"
mkdir -p "$STATE_DIR"
# Same OS lock as the installed automatic unit and direct agent CLI.
exec 9>"$STATE_DIR/.agent.flock"
flock -n 9 || { echo "已有升级任务正在执行" >&2; exit 1; }
# Executing imported agent code happens as root; candidate tests run in their
# own traversable staging directory under the configured service uid/gid.
TAG_JSON="$WORK/tag.json"
curl --fail --show-error --silent --location --retry 3 --connect-timeout 10 --max-time 60 \
  "https://api.github.com/repos/$UPDATE_REPOSITORY/commits/$VERSION" -o "$TAG_JSON"
"$NODE" --input-type=module - "$TAG_JSON" > "$WORK/commit" <<'JS'
import { readFileSync } from "node:fs";
const sha = JSON.parse(readFileSync(process.argv[2], "utf8")).sha;
if (!/^[0-9a-f]{40}$/i.test(sha || "")) throw new Error("标签没有有效的提交 SHA");
console.log(sha.toLowerCase());
JS
TARGET_COMMIT=$(cat "$WORK/commit")
curl --fail --show-error --silent --location --retry 3 --connect-timeout 10 --max-time 120 \
  "https://github.com/$UPDATE_REPOSITORY/archive/$TARGET_COMMIT.tar.gz" -o "$WORK/release.tar.gz"
mkdir "$WORK/source"
tar -xzf "$WORK/release.tar.gz" --strip-components=1 -C "$WORK/source"
"$NODE" --input-type=module - "$WORK/source/package.json" "$VERSION" <<'JS'
import { readFileSync } from "node:fs";
if (JSON.parse(readFileSync(process.argv[2], "utf8")).version !== process.argv[3].replace(/^v/, "")) throw new Error("发布包版本与升级目标不一致");
JS
"$NODE" "$WORK/source/scripts/upgrade-agent.mjs" --manual-version "$VERSION" --commit-sha "$TARGET_COMMIT" --flock-held
printf '升级完成：%s\n目标提交：%s\n' "$VERSION" "$TARGET_COMMIT"
printf '%s\n' '已保留站点 API 和代理配置。若从 v1.3 首次迁移，请按升级文档启用升级服务与 API 的 UPDATE_ENABLED 设置。'
