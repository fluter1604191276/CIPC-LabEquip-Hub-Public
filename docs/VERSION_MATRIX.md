# 版本与发布状态矩阵

核对日期：2026-09-18。

| 位置 | 版本 | 说明 |
| --- | --- | --- |
| 公网生产环境 | `v1.4.7` | 2026-09-18 23:57（北京时间）已完成切换；API、Web、数据库和升级 path 均已验证。 |
| 当前开发分支 | `v1.4.7` | 升级稳定性增强：提交 SHA 固定、并发锁、非 shell 测试、状态隔离、systemd 超时和前端轮询。 |
| 公开部署仓库 | `v1.4.7` | 已发布 GitHub Release；生产使用固定提交 `98facfd21737b356cc092fa5a003720bf75e6dce`。 |
| 学校机房环境 | 由校方确认 | 已部署环境先备份数据库，再按发布说明升级。 |

老师应固定使用发布标签：

```bash
git clone --branch v1.4.7 --depth 1 \
  https://github.com/fluter1604191276/CIPC-LabEquip-Hub-Public.git \
  /opt/cipc-labequip/current
```

数据库、备份、实际人员账号、服务器网段和本机凭据不从 GitHub 获取，必须按部署文档单独初始化或迁移。
