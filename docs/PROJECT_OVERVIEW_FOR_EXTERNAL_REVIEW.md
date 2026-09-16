# CIPC LabEquip Hub 项目概览

信息基线：2026-07-26。本文件描述当前 MVP 的运行目标，不将未接入的规划组件视为现有能力。

## 产品边界

CIPC LabEquip Hub 是实验室内部的设备台账、预约、维修保养与采购记录平台。用户通过共享 API 读写数据；前端不会将业务数据回退保存到浏览器本地存储。

预约提交后直接生效，数据库负责阻止同一设备的时间重叠。当前没有预约审批、批准、驳回或保管人审批流程。

## 角色模型

| 角色 | 范围 |
| --- | --- |
| `member` | 设备、预约、维修保养、采购 |
| `admin` | member 全部范围，另可管理成员 |
| `developer` | 开发与验收，可切换 member、admin、developer 三种界面视图 |

视图切换只改变 developer 的界面，不提升其他账号权限。角色模型不包含 custodian、lab_admin 或审批角色。

## 技术与部署

```text
Browser -> Caddy -> Nginx :8020 -> /api -> Node.js API :4000 -> SQLite
```

- API 仅监听 `127.0.0.1`，由 systemd 以 `NODE_ENV=production` 守护。
- 生产数据位于 `/var/lib/cipc-labequip/data/production.sqlite`，不放在可替换的 release 目录。
- Nginx 静态容器将 `/api/` 代理到宿主 API；Caddy 是 TLS 公网入口。
- 备份脚本使用 SQLite `VACUUM INTO` 创建一致性快照，保存在 `/var/lib/cipc-labequip/backups`。

## 账号与密码

预置账号首次密码为 `123456`，首次登录必须改密。管理员重置密码时，系统生成随机临时密码，注销该用户旧会话并要求再次改密。随机临时密码只应通过受控渠道发放。

## 已知后续工作

- 为设备、预约、维修保养和采购补齐所需的完整数据流、审计和测试。
- 在扩大多人使用或跨主机部署前评估 SQLite 的容量、锁竞争、异机备份和 PostgreSQL 迁移。
- 完成备份恢复演练、登录防护、监控告警和发布回滚记录。

部署命令和恢复步骤以 [VPS 部署说明](../deploy/vps/README.md) 为准；本地操作见 [部署与运维说明](DEPLOYMENT_PREP.md)。
