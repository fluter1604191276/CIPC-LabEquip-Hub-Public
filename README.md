# 实验室资源平台

实验室资源平台是实验室内部的设备台账、设备/会议室预约、维修保养、采购记录和操作审计平台。

- 最新代码版本：`v1.4.8`
- 推荐部署环境：Ubuntu 22.04 / 24.04 LTS，Node.js 22，Docker Engine + Compose
- 推荐使用方式：校内局域网部署，不开放公网 API
- 数据存储：单机 SQLite，生产数据与代码目录分离

> `v1.4.8` 修复升级中心在尚未检查更新时显示过期手动升级版本的问题，并保持 v1.4.7 的升级稳定性增强。新部署可固定使用 `v1.4.8` 标签；已部署的学校环境需按文档升级。版本差异见 [版本矩阵](docs/VERSION_MATRIX.md)。

## 系统结构

```text
校内浏览器
  -> http://服务器内网地址:8080
  -> Docker Nginx（静态页面和 /api 反向代理）
  -> Node.js API（systemd，127.0.0.1:4000）
  -> SQLite（/var/lib/cipc-labequip/data/production.sqlite）
```

API 不监听局域网网卡，浏览器只能通过 Nginx 访问。数据库、备份和代码位于不同目录，更新代码不会覆盖生产数据。

---

# Ubuntu 校内局域网部署

以下步骤适用于一台全新的 Ubuntu 22.04/24.04 机房主机。需要具有 `sudo` 权限，并确保主机能够访问 GitHub、NodeSource 和 Docker 软件源。

## 1. 先确认网络条件

查看服务器地址和网卡：

```bash
hostname -I
ip -br address
```

建议向机房网络管理员申请以下任一方案：

1. DHCP 静态租约，把服务器网卡固定到同一个内网 IP；
2. 校内 DNS 名称，例如 `labequip.school.lan`；
3. 若暂时都没有，先使用当前内网 IP 访问。

还需要确认教师和学生所在网段能够访问服务器 TCP `8080` 端口，校园 Wi-Fi 没有启用阻止终端互访的客户端隔离。

## 2. 安装基础工具

```bash
sudo apt update
sudo apt install -y ca-certificates curl git rsync ufw
```

安装 Node.js 22 和 pnpm 11：

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs
sudo npm install -g pnpm@11.9.0

node --version
pnpm --version
```

Node.js 应显示 `v22.x`，且路径应为：

```bash
command -v node
# /usr/bin/node
```

安装 Docker Engine 和 Compose 插件：

```bash
sudo install -m 0755 -d /etc/apt/keyrings
sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg \
  -o /etc/apt/keyrings/docker.asc
sudo chmod a+r /etc/apt/keyrings/docker.asc

. /etc/os-release
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu ${UBUNTU_CODENAME:-$VERSION_CODENAME} stable" \
  | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null

sudo apt update
sudo apt install -y docker-ce docker-ce-cli containerd.io \
  docker-buildx-plugin docker-compose-plugin
sudo systemctl enable --now docker

sudo docker version
sudo docker compose version
```

可选：允许当前用户以后不加 `sudo` 使用 Docker。执行后需要退出 SSH/桌面会话并重新登录：

```bash
sudo usermod -aG docker "$USER"
```

## 3. 下载固定版本代码

正式部署使用版本标签，不使用会持续变化的开发分支：

```bash
sudo install -d -m 0755 -o "$USER" -g "$USER" /opt/cipc-labequip

git clone --branch v1.4.8 --depth 1 \
  https://github.com/fluter1604191276/CIPC-LabEquip-Hub-Public.git \
  /opt/cipc-labequip/current

cd /opt/cipc-labequip/current
pnpm install --frozen-lockfile
pnpm check
```

`pnpm check` 必须全部通过后再继续。

## 4. 创建低权限服务账号和数据目录

```bash
id cipc-labequip >/dev/null 2>&1 || \
  sudo useradd --system --home /var/lib/cipc-labequip \
  --shell /usr/sbin/nologin cipc-labequip

sudo install -d -m 0750 -o cipc-labequip -g cipc-labequip \
  /var/lib/cipc-labequip \
  /var/lib/cipc-labequip/data \
  /var/lib/cipc-labequip/backups
```

生产 SQLite 文件不会提交到 GitHub，后续代码更新也不会删除该目录。

## 5. 初始化第一个管理员

生产模式默认不创建演示账号。为新空数据库创建第一个管理员：

```bash
cd /opt/cipc-labequip/current
read -r -s -p "请输入首个管理员密码（至少 8 位，含字母和数字）: " BOOTSTRAP_ADMIN_PASSWORD
echo

sudo -u cipc-labequip env \
  BOOTSTRAP_ADMIN_PASSWORD="$BOOTSTRAP_ADMIN_PASSWORD" \
  /usr/bin/node scripts/bootstrap-admin.mjs \
  --data /var/lib/cipc-labequip/data/production.sqlite \
  --username labadmin \
  --display-name "实验室管理员"

unset BOOTSTRAP_ADMIN_PASSWORD
```

该脚本仅允许在没有任何用户的数据库中执行。以后通过系统的“成员与权限”页面创建其他账号，不要重复运行初始化脚本。

## 6. 安装并启动 API

```bash
cd /opt/cipc-labequip/current
sudo install -m 0644 deploy/lan/cipc-labequip-api.service \
  /etc/systemd/system/cipc-labequip-api.service

sudo systemd-analyze verify /etc/systemd/system/cipc-labequip-api.service
sudo systemctl daemon-reload
sudo systemctl enable --now cipc-labequip-api.service

curl -fsS http://127.0.0.1:4000/api/health
```

查看日志：

```bash
sudo systemctl status cipc-labequip-api.service
sudo journalctl -u cipc-labequip-api.service -n 100 --no-pager
```

## 7. 启动局域网 Web 入口

```bash
sudo install -m 0644 /opt/cipc-labequip/current/deploy/lan/compose.yaml \
  /opt/cipc-labequip/compose.yaml
sudo install -m 0644 /opt/cipc-labequip/current/deploy/lan/nginx.conf \
  /opt/cipc-labequip/nginx.conf

# 必须把示例 allow 192.168.10.0/24 改成学校实际网段
sudoedit /opt/cipc-labequip/nginx.conf

cd /opt/cipc-labequip
sudo docker compose up -d
sudo docker compose ps

curl -fsS http://127.0.0.1:8080/healthz
curl -fsS http://127.0.0.1:8080/api/health
```

浏览器访问：

```text
http://<服务器内网IP>:8080
```

若已配置校内 DNS：

```text
http://labequip.school.lan:8080
```

## 8. 配置 Ubuntu 防火墙

先放行 SSH，避免远程管理被锁定。将示例网段替换成实际机房网段：

```bash
sudo ufw allow OpenSSH
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow from 192.168.10.0/24 to any port 8080 proto tcp
sudo ufw enable
sudo ufw status verbose
```

API 只监听 `127.0.0.1:4000`，不需要对外放行 4000 端口。`deploy/lan/nginx.conf` 还带有私有地址白名单；条件允许时应把它进一步收窄到学校实际网段。

## 9. 安装自动备份和运维检查

```bash
cd /opt/cipc-labequip/current

sudo install -m 0644 deploy/lan/cipc-labequip-backup.service \
  /etc/systemd/system/cipc-labequip-backup.service
sudo install -m 0644 deploy/lan/cipc-labequip-backup.timer \
  /etc/systemd/system/cipc-labequip-backup.timer
sudo install -m 0644 deploy/lan/cipc-labequip-operations.service \
  /etc/systemd/system/cipc-labequip-operations.service
sudo install -m 0644 deploy/lan/cipc-labequip-operations.timer \
  /etc/systemd/system/cipc-labequip-operations.timer

sudo systemd-analyze verify \
  /etc/systemd/system/cipc-labequip-backup.service \
  /etc/systemd/system/cipc-labequip-backup.timer \
  /etc/systemd/system/cipc-labequip-operations.service \
  /etc/systemd/system/cipc-labequip-operations.timer

sudo systemctl daemon-reload
sudo systemctl enable --now cipc-labequip-backup.timer
sudo systemctl start cipc-labequip-backup.service
sudo systemctl enable --now cipc-labequip-operations.timer
sudo systemctl start cipc-labequip-operations.service
```

检查结果：

```bash
systemctl list-timers 'cipc-labequip-*'
sudo journalctl -u cipc-labequip-backup.service -n 50 --no-pager
sudo journalctl -u cipc-labequip-operations.service -n 50 --no-pager
sudo ls -lht /var/lib/cipc-labequip/backups | head
```

## 10. 部署验收

在服务器执行：

```bash
curl -fsS http://127.0.0.1:4000/api/health
curl -fsS http://127.0.0.1:8080/api/health
sudo docker compose -f /opt/cipc-labequip/compose.yaml ps
sudo systemctl is-active cipc-labequip-api.service
```

在另一台校内电脑完成：

- 打开页面并使用 `labadmin` 登录；
- 创建一个测试成员；
- 新增一台测试设备；
- 创建和取消一次预约；
- 检查会议室管理与审计页面；
- 确认非允许网段不能访问；
- 确认服务器重启后 API、Docker 和 timer 自动恢复。

---

## 已有数据迁移

代码可以从 GitHub 下载，生产数据必须单独迁移。旧机器先创建一致性快照：

```bash
cd /opt/cipc-labequip/current
sudo -u cipc-labequip /usr/bin/node scripts/backup-db.mjs \
  --data /var/lib/cipc-labequip/data/production.sqlite \
  --output-dir /var/lib/cipc-labequip/backups \
  --keep 14
```

把最新 `.sqlite` 快照传到新服务器，先执行恢复演练，再安装为生产数据库。完整步骤见 [发布、迁移与部署流程](docs/RELEASE_AND_MIGRATION.md)。不要直接复制运行中 WAL 数据库的单个主文件。

## 日常更新

更新前先创建数据库备份。代码建议以新的 Git 标签发布，不直接在服务器编辑源码。更新后依次执行：

```bash
cd /opt/cipc-labequip/current
pnpm install --frozen-lockfile
pnpm check
sudo systemctl restart cipc-labequip-api.service
cd /opt/cipc-labequip
sudo docker compose up -d --force-recreate web
curl -fsS http://127.0.0.1:8080/api/health
```

## 常见故障

### 页面打不开

```bash
hostname -I
sudo ufw status verbose
sudo docker compose -f /opt/cipc-labequip/compose.yaml ps
curl -v http://127.0.0.1:8080/healthz
```

若服务器本机正常、其他电脑不通，通常是网段/VLAN/无线客户端隔离问题，需要联系机房网络管理员。

### API 返回 502

```bash
sudo systemctl status cipc-labequip-api.service
sudo journalctl -u cipc-labequip-api.service -n 100 --no-pager
curl -v http://127.0.0.1:4000/api/health
```

### Docker 权限错误

临时使用 `sudo docker ...`；若已运行 `usermod -aG docker`，退出后重新登录。

### 服务器 IP 改变

向网络管理员申请 DHCP 静态租约或校内 DNS。应用代码不依赖固定 IP，但用户需要稳定入口。

---

## 开发者一键升级

从 v1.4.0 起，学校部署可以安装一次 `cipc-labequip-upgrade.path`。开发者在“系统升级”页面检查正式稳定版后，服务器会自动完成数据库备份、下载、测试、切换和健康检查。升级代理由 systemd 独立运行，网页不会直接执行服务器命令。

已经部署 v1.3.0 及之后版本的学校，可直接执行 [快速升级命令](docs/RELEASE_AND_MIGRATION.md#upgrade-v1-4-8)。安装命令和回滚说明见 [发布、迁移与部署流程](docs/RELEASE_AND_MIGRATION.md) 以及 [局域网部署说明](deploy/lan/README.md)。数据库回滚仍需管理员按备份恢复流程显式执行。

## 本地开发

要求 Node.js 22-24 与 pnpm 9-11：

```bash
pnpm install
pnpm env:check
pnpm dev
```

访问 `http://localhost:3000`，执行完整检查：

```bash
pnpm check
```

## 版本与文档

- [v1.4.8 发布说明](docs/RELEASE_NOTES_v1.4.8.md)
- [v1.4.7 发布说明](docs/RELEASE_NOTES_v1.4.7.md)
- [v1.4.6 发布说明](docs/RELEASE_NOTES_v1.4.6.md)
- [v1.4.5 发布说明](docs/RELEASE_NOTES_v1.4.5.md)
- [v1.3.0 发布说明](docs/RELEASE_NOTES_v1.3.0.md)
- [版本矩阵](docs/VERSION_MATRIX.md)
- [发布、迁移与部署流程](docs/RELEASE_AND_MIGRATION.md)
- [局域网部署说明](deploy/lan/README.md)
- [架构](docs/ARCHITECTURE.md)
- [数据字典](docs/DATA_DICTIONARY.md)
- [使用指南](docs/USER_GUIDE.md)
- [公开仓库前检查](docs/PUBLIC_RELEASE_CHECKLIST.md)

## 许可证

本项目以 [MIT License](LICENSE) 发布，可用于教学、部署和二次开发。生产数据、真实账号和站点凭据不属于开源内容。
