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
