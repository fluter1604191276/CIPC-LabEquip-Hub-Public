# 部署与运维说明

## 本地开发

当前 MVP 使用 Node.js 与 SQLite，不依赖 Docker。要求 Node.js 22-24、pnpm 9-11 与 Git：

```bash
pnpm env:check
pnpm install
pnpm dev
```

项目脚本不会自动读取 `.env`。复制模板后，需要以 Node 的 `--env-file` 参数显式加载：

```bash
cp .env.example .env
node --env-file=.env apps/api/server.mjs
```

当前实际变量为 `NODE_ENV`、`API_PORT`、`WEB_PORT`、`DATA_FILE`、`CORS_ORIGINS`、`SEED_DEMO_USERS`、`TRUST_PROXY`、`COOKIE_SECURE`、`BACKUP_DIR` 与 `BACKUP_RETENTION`。`COOKIE_SECURE` 留空时跟随生产模式默认开启；只有明确的 HTTP 局域网 systemd 单元才设置为 `false`。生产单元默认关闭演示用户播种，空库使用 `scripts/bootstrap-admin.mjs` 初始化首个管理员。根目录 `compose.yaml` 仅为未来基础设施试验保留，不是当前启动或生产部署步骤；校内局域网部署使用 `deploy/lan/`。

## VPS 运行要求

生产部署使用以下边界：

```text
Caddy -> Nginx container :8020 -> /api -> Node.js API :4000 (loopback only)
                                      -> /var/lib/cipc-labequip/data/production.sqlite
```

部署配置位于 `deploy/vps/`：

- `cipc-labequip-api.service`：systemd API 服务，固定 `NODE_ENV=production` 和绝对 `DATA_FILE`。
- `nginx.conf`：静态站点和 `/api/` 代理。
- `compose.yaml`：Nginx 容器使用 host network，并通过宿主回环访问 API。
- `README.md`：服务安装、健康检查、恢复和发布回滚命令。

不要将 API 端口公开映射到 Internet。发布后应依次验证：

```bash
curl -fsS http://127.0.0.1:4000/api/health
curl -fsS http://127.0.0.1:8020/api/health
```

## 备份与恢复

SQLite 使用 WAL 模式。直接复制单独的 `.sqlite` 文件可能遗漏 WAL 中的已提交数据，因此必须使用：

```bash
node scripts/backup-db.mjs \
  --data /var/lib/cipc-labequip/data/production.sqlite \
  --output-dir /var/lib/cipc-labequip/backups --keep 14
```

`VACUUM INTO` 会生成一致性快照。恢复时停止 API，先备份当前文件，将快照安装为 `production.sqlite`，删除旧 `-wal`/`-shm` 文件，启动 API 并检查 `/api/health`。可直接按 [VPS 部署说明](../deploy/vps/README.md) 的完整命令演练。

## 发布前检查

- [ ] 已创建 `cipc-labequip` 系统用户和 `/var/lib/cipc-labequip/{data,backups}`，并正确授权
- [ ] systemd 单元使用生产域名作为 `CORS_ORIGINS`
- [ ] 生产 SQLite 文件使用绝对路径且不在 release 目录
- [ ] 已完成一次备份、恢复和健康检查演练
- [ ] 已验证 member、admin、developer 三种界面与无审批预约流程
- [ ] 已验证初始密码改密与随机临时密码重置流程
