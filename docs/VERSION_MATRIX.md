# 版本与发布状态矩阵

核对日期：2026-09-16。

| 位置 | 版本 | 说明 |
| --- | --- | --- |
| 原公网生产环境（仓库记录） | `v1.2.1` | 线上主机未在本次发布中修改。 |
| 内部历史仓库 `CIPC-LabEquip-Hub` | `v1.3.0` 开发/发布来源 | 保留历史追溯，仓库维持 Private。 |
| 公开部署仓库 `CIPC-LabEquip-Hub-Public` | `v1.3.0` | 使用脱敏后的干净首提交和 `v1.3.0` 标签，供老师部署。 |
| 学校机房新部署 | `v1.3.0` | 按根 README 的 Ubuntu 局域网步骤部署。 |

老师应固定使用发布标签：

```bash
git clone --branch v1.3.0 --depth 1 \
  https://github.com/fluter1604191276/CIPC-LabEquip-Hub-Public.git \
  /opt/cipc-labequip/current
```

数据库、备份、实际人员账号、服务器网段和本机凭据不从 GitHub 获取，必须按部署文档单独初始化或迁移。
