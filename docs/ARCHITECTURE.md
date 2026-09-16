# 系统架构

## 当前实现

```text
LAN Browser / Internet Browser
  -> Web single-page application
  -> /api reverse proxy
  -> Node.js API (127.0.0.1:4000)
  -> SQLite (persistent DATA_FILE)
```

Web 使用原生 HTML、CSS、JavaScript；API 使用 Node.js 内置 HTTP 和 `node:sqlite`。SQLite 是当前单机部署的持久化层，API 单进程由 systemd 守护，数据库文件与备份位于 `/var/lib/cipc-labequip`。公网 VPS 使用 Caddy → Nginx，校内局域网使用 `deploy/lan/` 的 Nginx 入口，不配置公网域名。

## 服务边界

- Web：登录界面、设备、设备预约、会议室预约、维修保养、采购与成员页面。
- API：会话、角色校验、业务校验和 SQLite 访问。
- Nginx：托管静态站点并将 `/api/` 代理到本机 API。
- Caddy：仅用于公网 VPS 的 TLS 入口并转发到 Nginx。
- LAN Nginx：局域网方案监听 8080，仅允许回环、RFC1918/ULA 私有网段并转发 `/api/`。
- SQLite：单机业务事实；使用 `VACUUM INTO` 生成备份快照，并在成功返回前执行 `PRAGMA integrity_check`。

## 角色边界

- `member`：设备、设备预约、会议室预约、维修保养、采购。
- `admin`：member 的全部能力，加成员管理。
- `developer`：维护和验收，可在三个界面视图之间切换。

设备和会议室预约直接提交生效，系统不包含审批流程。三种登录角色均可调用会议室列表、预约列表和新建预约 API；提交者可取消自己尚未开始的预约，developer 可执行维护性取消。预约列表根据 `start_at`、`end_at` 与当前时间动态返回 `approved`、`in_use` 或 `completed`，不依赖定时任务修改数据库。

`GET /api/my-reservations` 在服务端按真实会话用户合并设备和会议室预约，因此前端不依赖可伪造的显示角色过滤个人数据。关键写操作同时追加 `audit_logs`；审计写入与业务写入共用事务。member 的审计查询按本人操作者 ID 过滤，admin/developer 可查询全量，开发者前端模拟视图不参与授权判断。

## 关键约束

1. 预约开始时间必须晚于当前时间并早于结束时间。
2. 同一设备或会议室的有效预约不重叠；相邻时间段允许首尾相接。
3. 维修、停用、报废设备不能创建预约。
4. 会议室预约人数为正整数，且不得超过 `meeting_rooms.capacity`；不可预约未启用的会议室。
5. 已开始或已完成的预约不能取消；取消操作只改变尚未开始的预约。
6. 生产 API 使用绝对 `DATA_FILE`，并且不对公网开放监听端口；局域网入口还需配合主机防火墙限制实际实验室网段。
7. 备份只能使用通过完整性检查的一致性 SQLite 快照；恢复需先停止 API。
8. 自动备份使用独立 systemd oneshot/timer，只有备份目录可写，不依赖公网网络。

未来扩展 PostgreSQL、对象存储或通知服务时，应先明确迁移、权限与备份恢复策略，不能假定这些组件已在当前 MVP 中运行。
