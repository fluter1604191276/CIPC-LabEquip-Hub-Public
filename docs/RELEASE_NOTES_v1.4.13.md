# 实验室资源平台 v1.4.13 发布说明

发布日期：2026-09-19。状态：修复版发布到公开部署仓库；用于修正 v1.4.12 生产升级前置测试在 systemd 环境中的配置隔离问题。

## 修复内容

- 升级代理运行候选 release 的语法检查与全量测试时，清理生产 unit 注入的 `UPDATE_*`、`APP_VERSION`、`UPDATE_ENABLED`、数据库路径和健康地址变量，避免站点配置覆盖测试夹具，导致本来通过的发布包被错误阻止。
- 保留升级代理自身的站点配置用于备份、服务切换和健康检查；只有候选测试子进程使用隔离环境。
- 增加回归断言，验��测试子进程不会继承 `UPDATE_SERVICE_GROUP`、`DATA_FILE` 等生产变量。
- 继续保留 v1.4.12 的新增设备教程、认证竞态修复、跨进程升级锁、代理来源校验、预约状态一致性和升级回滚保护。

## 兼容性与升级

- 兼容 v1.3.0 及之后的生产数据库，不需要数据库迁移。
- 从 v1.4.11 或 v1.4.12 升级前仍需创建包含 WAL 的 SQLite 一致性快照，并保留当前 release。
- v1.4.12 生产升级曾在候选测试阶段停止，未切换 current；v1.4.13 可在相同环境重新执行升级。
- 生产升级前同步 v1.4.13 的 API、升级 unit 和 Nginx 模板；升级 unit 必须包含 `--flock-held`。

## 验证结果

- 本地专项升级代理测试：32 项，29 通过、3 项 Linux 专项在 macOS 跳过、0 失败。
- 发布前完整回归仍需在本地和 Ubuntu 部署机分别运行；Ubuntu 上应额外验证真实服务账号降权、flock 串行化和 systemd unit。

## 快速升级

```bash
cd /opt/cipc-labequip/current
git fetch --tags origin
git show v1.4.13:scripts/upgrade-lan-from-v1.3.sh > /tmp/upgrade-lan-from-v1.3.sh
sudo bash /tmp/upgrade-lan-from-v1.3.sh v1.4.13
```

升级后核对 `package.json`、API/Web 健康接口、systemd 状态和数据库数据；失败时升级代理会恢复上一代码 release，数据库恢复仍需使用备份快照。
