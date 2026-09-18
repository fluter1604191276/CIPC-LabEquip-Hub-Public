# Ubuntu 校内局域网部署模板

此目录提供 Ubuntu 22.04/24.04 的局域网部署文件：

- `cipc-labequip-api.service`：Node.js API，只监听 `127.0.0.1:4000`；
- `compose.yaml`：Docker Nginx，监听局域网 `8080`；
- `nginx.conf`：静态页面、`/api` 代理和私有网段白名单；
- `cipc-labequip-backup.service/.timer`：每日 SQLite 一致性备份；
- `cipc-labequip-operations.service/.timer`：每 15 分钟检查 API、数据库、备份时效和磁盘。

完整的从零安装命令位于仓库根目录 [README](../../README.md)。建议老师严格按根 README 的顺序部署，不要混用 `deploy/vps/` 的公网 Caddy 配置。

## 固定边界

```text
校内电脑 -> Ubuntu:8080 -> Docker Nginx -> 127.0.0.1:4000 -> Node API -> SQLite
```

- 不配置公网域名或端口映射；
- API 4000 端口不对局域网开放；
- 生产单元不创建演示用户；
- 空数据库用 `scripts/bootstrap-admin.mjs` 初始化首个管理员；
- 数据位于 `/var/lib/cipc-labequip`，不随 Git 更新覆盖；
- Node.js 由 Ubuntu NodeSource 安装到 `/usr/bin/node`。

部署前需要把防火墙和 `nginx.conf` 白名单收窄到学校实际网段，并优先申请 DHCP 静态租约或校内 DNS 名称。

## 开发者一键升级通道（v1.4.0 起）

升级中心不是网页直接执行 shell 命令，而是“网页提交请求 + systemd 升级代理执行”。首次部署或升级到 v1.4.0 时安装一次：

```bash
cd /opt/cipc-labequip/current
sudo install -d -o cipc-labequip -g cipc-labequip /var/lib/cipc-labequip/data/upgrade
sudo install -m 0644 deploy/lan/cipc-labequip-upgrade.service /etc/systemd/system/cipc-labequip-upgrade.service
sudo install -m 0644 deploy/lan/cipc-labequip-upgrade.path /etc/systemd/system/cipc-labequip-upgrade.path
sudo systemctl daemon-reload
sudo systemctl enable --now cipc-labequip-upgrade.path
```

以后登录开发者账号，打开“系统升级”：

1. 点击“检查更新”；
2. 阅读正式版本说明；
3. 点击“备份并升级”；
4. 等待任务状态变为完成。

升级代理会固定读取公开稳定版本，创建 SQLite 快照，下载版本并运行测试，再切换 release、重启 API、重建 Web 容器和执行健康检查。失败时会尝试恢复上一代码 release；数据库不会自动回滚。

查看升级日志：

```bash
sudo systemctl status cipc-labequip-upgrade.service
sudo journalctl -u cipc-labequip-upgrade.service -n 100 --no-pager
cat /var/lib/cipc-labequip/data/upgrade/status.json
```

升级期间页面可能短暂显示网络错误，刷新后查看状态即可。升级代理使用 root 运行是因为它需要切换 release、重启 systemd 服务和重建 Docker 容器；网页本身不会直接获得这些权限。
