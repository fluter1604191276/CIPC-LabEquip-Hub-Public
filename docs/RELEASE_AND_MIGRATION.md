# 发布、迁移与部署流程

本文件用于把本地开发版交付给老师或其他部署人员。当前仓库同时保留公网 VPS 模板和校内局域网模板；老师的场景优先使用 `deploy/lan/`。

## 0. 发布前版本确认

在发布机器执行：

```bash
git status --short --branch
git fetch --prune origin
git branch -avv
git tag --sort=-creatordate | head
pnpm check
```

必须确认：

- 工作区没有未审查的改动；
- `pnpm check` 全部通过；
- 发布提交的 `package.json.version`、发布说明和 Git 标签一致；
- 生产版本、GitHub 默认分支和待发布版本的差异已记录在 `docs/VERSION_MATRIX.md`。

## 1. 老师首次部署（无旧生产数据）

### 1.1 准备主机

推荐一台长期运行的 Linux 主机，具备：

- Node.js 22–24；
- pnpm 9–11；
- Docker Compose；
- systemd；
- 校内网络中的稳定地址（DHCP 静态租约或校内 DNS）。

### 1.2 获取固定版本代码

不要直接使用会变化的开发分支。正式标签发布后执行；在标签尚未创建时，先使用老师指定的验收分支：

```bash
git clone --branch v1.3.0 --depth 1 https://github.com/fluter1604191276/CIPC-LabEquip-Hub-Public.git /opt/cipc-labequip/source
sudo mkdir -p /opt/cipc-labequip/current
sudo rsync -a --delete /opt/cipc-labequip/source/ /opt/cipc-labequip/current/
cd /opt/cipc-labequip/current
pnpm install --frozen-lockfile
pnpm check
```

### 1.3 创建运行账号和数据目录

```bash
sudo useradd --system --home /var/lib/cipc-labequip \
  --shell /usr/sbin/nologin cipc-labequip
sudo install -d -o cipc-labequip -g cipc-labequip \
  /var/lib/cipc-labequip/data /var/lib/cipc-labequip/backups
```

### 1.4 安装局域网 API

```bash
sudo install -m 0644 \
  /opt/cipc-labequip/current/deploy/lan/cipc-labequip-api.service \
  /etc/systemd/system/cipc-labequip-api.service
sudo systemctl daemon-reload
```

生产单元默认不播种演示账号。若这是全新的空数据库，先设置一次性管理员密码并执行初始化脚本：

```bash
read -r -s BOOTSTRAP_ADMIN_PASSWORD
export BOOTSTRAP_ADMIN_PASSWORD
node /opt/cipc-labequip/current/scripts/bootstrap-admin.mjs \
  --data /var/lib/cipc-labequip/data/production.sqlite \
  --username labadmin \
  --display-name "实验室管理员"
unset BOOTSTRAP_ADMIN_PASSWORD
```

脚本只在数据库没有任何用户时执行，创建 `admin` 账号并立即完成首次改密；已有生产数据库不要重复执行。

初始化完成后启动 API：

```bash
sudo systemctl enable --now cipc-labequip-api.service
curl -fsS http://127.0.0.1:4000/api/health
```

### 1.5 启动局域网 Web 入口

```bash
sudo cp /opt/cipc-labequip/current/deploy/lan/compose.yaml \
  /opt/cipc-labequip/compose.yaml
sudo cp /opt/cipc-labequip/current/deploy/lan/nginx.conf \
  /opt/cipc-labequip/nginx.conf
# 将示例 allow 192.168.10.0/24 改成学校实际网段
sudoedit /opt/cipc-labequip/nginx.conf
cd /opt/cipc-labequip
sudo docker compose up -d --force-recreate web
curl -fsS http://127.0.0.1:8080/healthz
```

访问地址：

```text
http://<主机内网IP>:8080
```

如果配置了校内 DNS，则使用固定名称，例如：

```text
http://labequip.school.lan:8080
```

### 1.6 防火墙和网络

只允许实际实验室网段访问 8080；4000 不对外开放。示例：

```bash
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow from 192.168.10.0/24 to any port 8080 proto tcp
sudo ufw enable
```

同时在 `deploy/lan/nginx.conf` 中补充实际网段的 `allow` 规则。若校园网启用了无线隔离或 VLAN 隔离，需要由网络管理员确认客户端能访问服务器。

## 2. 从旧机器迁移生产数据

### 2.1 旧机器创建一致性快照

不要直接复制 WAL 模式下正在运行的单独 `.sqlite` 主文件。旧机器执行：

```bash
cd /opt/cipc-labequip/current
sudo -u cipc-labequip node scripts/backup-db.mjs \
  --data /var/lib/cipc-labequip/data/production.sqlite \
  --output-dir /var/lib/cipc-labequip/backups \
  --keep 14
```

查看最新快照并记录文件名：

```bash
ls -lht /var/lib/cipc-labequip/backups | head
```

### 2.2 将快照传到新机器

```bash
scp /var/lib/cipc-labequip/backups/<BACKUP.sqlite> \
  <new-host>:/tmp/<BACKUP.sqlite>
```

### 2.3 新机器安装并验证快照

```bash
cd /opt/cipc-labequip/current
sudo -u cipc-labequip node scripts/restore-drill.mjs \
  --backup /tmp/<BACKUP.sqlite>
```

确认输出中的完整性检查和关键表检查均为 `ok` 后，再安装数据库：

```bash
# 进入维护窗口，先停止 Web 写入入口和 API
cd /opt/cipc-labequip
sudo docker compose stop web
sudo systemctl stop cipc-labequip-api.service

# 若新机器已有数据库，先保留一份回滚快照
if [ -f /var/lib/cipc-labequip/data/production.sqlite ]; then
  sudo -u cipc-labequip /usr/bin/node \
    /opt/cipc-labequip/current/scripts/backup-db.mjs \
    --data /var/lib/cipc-labequip/data/production.sqlite \
    --output-dir /var/lib/cipc-labequip/backups --keep 14
fi

sudo install -o cipc-labequip -g cipc-labequip -m 0600 \
  /tmp/<BACKUP.sqlite> \
  /var/lib/cipc-labequip/data/production.sqlite
sudo rm -f \
  /var/lib/cipc-labequip/data/production.sqlite-wal \
  /var/lib/cipc-labequip/data/production.sqlite-shm
sudo systemctl start cipc-labequip-api.service
sudo docker compose start web
curl -fsS http://127.0.0.1:4000/api/health
curl -fsS http://127.0.0.1:8080/api/health
```

## 3. 生产发布新代码

1. 先执行数据库备份。
2. 保留当前 release 目录和回滚指针。
3. 将新标签导出到新的 release 目录，不覆盖旧目录。
4. 执行 `pnpm install --frozen-lockfile` 和 `pnpm check`。
5. 切换 `current` 指针。
6. 重启 API，重建 Web 容器。
7. 执行本机和局域网健康检查。

示例（将 `vX.Y.Z` 替换为实际新标签）：

```bash
VERSION=vX.Y.Z
cd /opt/cipc-labequip/current
git fetch --tags --prune
git rev-parse --verify "refs/tags/$VERSION"

sudo install -d /opt/cipc-labequip/releases
sudo systemctl stop cipc-labequip-api.service
cd /opt/cipc-labequip
sudo docker compose stop web
sudo cp -a /opt/cipc-labequip/current \
  /opt/cipc-labequip/releases/pre-$VERSION-$(date -u +%Y%m%dT%H%M%SZ)

cd /opt/cipc-labequip/current
git checkout --detach "$VERSION"
pnpm install --frozen-lockfile
pnpm check

sudo systemctl start cipc-labequip-api.service
cd /opt/cipc-labequip
sudo docker compose up -d --force-recreate web
curl -fsS http://127.0.0.1:4000/api/health
curl -fsS http://127.0.0.1:8080/healthz
```

## 4. 回滚

代码回滚与数据库回滚分开处理：

- 代码异常：恢复上一 release，重启 API 和 Web；
- 数据异常：停止 API，先创建当前数据库快照，再按备份恢复步骤安装经验证的快照；
- 回滚完成后重新检查 `/api/health`、登录、设备列表和预约数据。

不要为了回滚代码删除生产数据库。

## 5. 公开仓库前检查

```bash
git status --short
git ls-files | rg '(^|/)(\.env|.*\.sqlite|.*\.sqlite-wal|.*\.sqlite-shm)$' || true
rg -n -i 'BEGIN (RSA|OPENSSH|EC) PRIVATE|api[_-]?key|access[_-]?token|secret|password|123456|真实域名|真实姓名' \
  --glob '!pnpm-lock.yaml' .
pnpm check
git diff --check
```

公开前必须另外人工确认：

- `docs/ACCOUNT_DIRECTORY.md` 和 `apps/api/lib/database.mjs` 中是否仍含真实人员姓名、可识别用户名；
- `.env.example`、Compose 默认值和 systemd 配置是否都只是开发占位值；
- 生产域名、Cloudflare/Caddy 配置是否确实允许公开；
- 生产数据库、备份、临时密码和私钥没有进入 Git 历史；
- 发布标签对应的提交已经推送，并且老师能从标签复现部署。

## v1.3.0/v1.3.1/v1.4.0 快速升级到 v1.4.1

如果学校已经按旧版部署，最简单的方式是在服务器执行下面的命令。它会自动备份数据库、获取 v1.4.1、运行测试、更新 API 单元、安装升级中心并重建 Web；不会覆盖 `/opt/cipc-labequip/nginx.conf`，也不会删除生产数据库：

```bash
cd /opt/cipc-labequip/current
git fetch --tags origin
git show v1.4.1:scripts/upgrade-lan-from-v1.3.sh > /tmp/upgrade-lan-from-v1.3.sh
sudo bash /tmp/upgrade-lan-from-v1.3.sh v1.4.1
```

升级完成后，开发者进入“成员与权限 → 系统升级”即可进行后续版本升级。升级失败时脚本会尝试恢复升级前的代码提交；数据库快照位于 `/var/lib/cipc-labequip/backups`。

## 开发者升级中心（v1.4.0 起）

学校部署升级到 v1.4.0 后，可以安装一次升级代理：

```bash
cd /opt/cipc-labequip/current
sudo install -d -o cipc-labequip -g cipc-labequip /var/lib/cipc-labequip/data/upgrade
sudo install -m 0644 deploy/lan/cipc-labequip-upgrade.service /etc/systemd/system/cipc-labequip-upgrade.service
sudo install -m 0644 deploy/lan/cipc-labequip-upgrade.path /etc/systemd/system/cipc-labequip-upgrade.path
sudo systemctl daemon-reload
sudo systemctl enable --now cipc-labequip-upgrade.path
```

安装后，开发者进入“系统升级”页面即可检查稳定版并提交升级。服务器上的 `cipc-labequip-upgrade.path` 监听升级请求，`cipc-labequip-upgrade.service` 负责：

- 校验目标版本是公开仓库的稳定标签；
- 创建经过完整性检查的数据库快照；
- 下载版本并运行语法检查和全量测试；
- 停止服务、切换 release、启动 API、重建 Web；
- 检查 API、Nginx 和数据库；
- 失败时恢复上一代码 release，并把结果写入 `status.json`。

升级代理不删除数据库，也不执行数据库降级。网页升级期间如果暂时显示网络错误，刷新页面查看任务状态即可。若代理安装不完整，系统升级页面会显示“升级服务未配置”，不影响原有业务。
