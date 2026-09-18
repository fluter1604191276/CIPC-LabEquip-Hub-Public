# 实验室资源平台 v1.4.7 发布说明

发布日期：2026-09-18

## 本版重点

v1.4.7 是 v1.4.6 的升级链路修正版，重点处理超时恢复和版本绑定校验。业务数据模型保持兼容。

### 升级稳定性修复

- systemd 超时后自动识别并隔离遗留的 `queued/running` 请求，避免升级中心长期卡死。
- 升级前重新验证版本标签指向的 commit SHA，防止请求文件被篡改后安装非目标提交。
- 兼容带 `v` 和不带 `v` 的 Git 标签。
- LAN/VPS 升级单元增加系统级 `flock` 互斥。
- 失败状态保留当前版本、目标标签、目标提交 SHA 和上一 release 路径。
- 模拟管理员或普通用户视图时停止无意义的升级状态轮询。

## 升级方式

已安装 v1.4.0 及之后升级代理的环境，建议先按迁移文档将代码更新到 v1.4.7；之后继续使用“系统升级”页面。

v1.4.6 已发布但未作为生产目标版本使用时，直接升级到 v1.4.7 即可，无需恢复数据库。

## 验证

```bash
curl -fsS http://127.0.0.1:4000/api/health
curl -fsS http://127.0.0.1:8020/healthz
sudo systemctl status cipc-labequip-api.service --no-pager
sudo systemctl status cipc-labequip-upgrade.path --no-pager
cat /var/lib/cipc-labequip/data/upgrade/status.json
```

## 公网生产回执

- 2026-09-18 23:57（北京时间）完成公网生产切换。
- 生产 release：`/opt/cipc-labequip/releases/20260918T155435Z-v1.4.7-manual-v`。
- API `/api/health`、Web `/healthz`、Docker Web 容器和升级 path 均正常。
- 升级前 SQLite 快照已保留；上一代码 release 为 v1.4.5。
