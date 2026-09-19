# 实验室资源平台 v1.4.14 发布说明

发布日期：2026-09-19。状态：已发布到公开部署仓库并完成公网生产切换。

## 修复内容

- 将正式页面和“边做边学”页面的 CSS/JavaScript cache-busting 标记统一更新为 `v1.4.14`，避免浏览器继续复用 v1.4.12 资源 URL。
- 保留 v1.4.13 的升级代理测试环境隔离修复，以及 v1.4.12 的新增设备教程、认证竞态、升级并发锁、代理来源校验、预约状态一致性和回滚保护。
- 不涉及数据库结构变化，不需要迁移脚本。

## 验证结果

- 本地完整回归：227 项测试，224 通过、3 项 Linux 专项因 macOS 环境跳过、0 失败。
- 前端缓存标记定向回归：44/44 通过。
- Node 语法、Shell 语法和 `git diff --check` 通过。
- Ubuntu 生产候选包测试：227 项，225 通过、2 项特权专项跳过、0 失败。
- 公网生产 current、API unit 与升级状态均为 `v1.4.14`；API/Web 健康检查通过。
- 公网 HTML 已确认引用 `styles.css?v=1.4.14`、`app.js?v=1.4.14`、`tutorial.js?v=1.4.14` 和 `tutorial-api.js?v=1.4.14`。
- 升级前后均创建并验证了 SQLite 一致性快照，上一 release 保留为 v1.4.13。

## 升级与验证

- 升级前创建包含 WAL 的 SQLite 一致性快照，并保留当前 v1.4.13 release。
- 已部署 v1.4.11、v1.4.12 或 v1.4.13 的环境可使用同一升级脚本升级到 v1.4.14：

```bash
cd /opt/cipc-labequip/current
git fetch --tags origin
git show v1.4.14:scripts/upgrade-lan-from-v1.3.sh > /tmp/upgrade-lan-from-v1.3.sh
sudo bash /tmp/upgrade-lan-from-v1.3.sh v1.4.14
```

- 升级代理会先执行候选包测试、创建备份、切换 API/Web 并检查健康接口；失败时恢复上一代码 release。
- 升级后确认页面源码中的 `styles.css?v=1.4.14`、`app.js?v=1.4.14`，并验证登录、设备台账、预约和“需要帮助”教程。
