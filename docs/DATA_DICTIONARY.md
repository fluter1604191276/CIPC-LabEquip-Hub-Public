# 数据字典（MVP）

## users

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| id | UUID | 用户主键 |
| username | string | 唯一登录名，不区分大小写 |
| display_name | string | 显示名称 |
| role | enum | `member`、`admin`、`developer` |
| laboratory_id | UUID/null | 默认实验室或空间 |
| password_hash / password_salt | string | scrypt 密码哈希与盐值 |
| must_change_password | boolean | 初始或重置临时密码是否必须修改 |
| is_active | boolean | 是否可登录 |

## laboratories

`id`, `code`, `name`, `alias`, `sort_order`, `is_active`, `created_at`, `updated_at`

## equipment

`id`, `name`, `code`, `metric`, `lab`, `owner`, `status`, `icon`, `thumb`, `created_at`, `updated_at`

业务可用状态：`available`、`maintenance`、`disabled`、`retired`。数据库约束暂时兼容旧值 `reserved`，应用启动时会将旧值归一为 `available`；预约占用只从预约记录按时段计算。

## reservations

`id`, `equipment_id`, `reservation_date`, `start_time`, `end_time`, `start_at`, `end_at`, `people`, `purpose`, `requester_name`, `requester_lab`, `requester_user_id`, `status`, `created_at`, `updated_at`

当前预约不经过审批；新建记录存为 `approved`，取消记录存为 `cancelled`。API 根据 `start_at` 和 `end_at` 动态将未取消记录返回为 `approved`（未开始）、`in_use`（使用中）或 `completed`（已完成），不需要定时更新状态。开始时间必须晚于当前时间，仅 `approved` 状态可取消。`approved` 和 `in_use` 采用左闭右开时间范围阻止同设备重叠。

## meeting_rooms

`id`, `name`, `code`, `capacity`, `location`, `is_active`, `created_at`, `updated_at`

- `capacity` 为 1 至 500 的整数，表示单次预约允许的最大人数。
- 仅 `is_active = 1` 的会议室会出现在可预约列表中。

## room_reservations

`id`, `meeting_room_id`, `reservation_date`, `start_time`, `end_time`, `start_at`, `end_at`, `people`, `purpose`, `requester_name`, `requester_lab`, `requester_user_id`, `status`, `created_at`, `updated_at`

- 状态：`approved`、`cancelled`、`in_use`、`completed`；新建预约直接以 `approved` 生效，不经过审批流。API 按起止时间动态返回 `in_use` 和 `completed`。
- `people` 必须为正整数且不超过关联 `meeting_rooms.capacity`。
- `approved` 和 `in_use` 的同一会议室预约采用左闭右开时间范围，不能重叠。
- `meeting_room_id` 外键关联会议室；`requester_user_id` 关联提交预约的登录成员，用于取消权限校验。
- 开始时间必须晚于当前时间；仅尚未开始的 `approved` 预约可由提交者或 developer 取消。

会议室 API：`GET /api/meeting-rooms`、`GET /api/room-reservations`、`POST /api/room-reservations`、`PATCH /api/room-reservations/:id/cancel`。三种登录角色均可读取和新建；提交者可取消自己尚未开始的预约，developer 可取消任意尚未开始的预约。

个人预约 API：`GET /api/my-reservations?status=STATUS`。服务端按当前会话用户合并 `reservations` 与 `room_reservations`，统一返回资源类型、资源编号、资源名称及动态生命周期状态。可选状态为 `approved`、`in_use`、`completed`、`cancelled`。

## maintenance_records

`id`, `equipment_id`, `type`, `status`, `record_date`, `description`, `cost`, `created_by_user_id`, `created_at`, `updated_at`

- 类型：`repair`、`maintenance`。
- 状态：`open`、`in_progress`、`completed`。
- `open` 或 `in_progress` 会驱动关联设备进入 `maintenance`；该设备全部记录完成后恢复 `available`，但不会覆盖 `disabled` 或 `retired`。
- API：`GET/POST /api/maintenance-records`、`PATCH /api/maintenance-records/:id`。

## procurement_records

`id`, `equipment_id`, `vendor`, `procurement_date`, `amount`, `status`, `notes`, `created_by_user_id`, `created_at`, `updated_at`

状态：`pending`、`accepted`、`rejected`。采购总额仅汇总 `accepted` 记录。

采购 API：`GET/POST /api/procurement-records`、`PATCH /api/procurement-records/:id`。维修保养与采购记录均保存创建成员；当前可更新业务状态，其他字段编辑和附件不在本轮范围。

## audit_logs

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| id | UUID | 审计记录主键 |
| actor_user_id | UUID/null | 操作者；删除用户后置空 |
| actor_display_name | string | 操作发生时的姓名快照 |
| actor_username | string | 操作发生时的用户名快照 |
| entity_type | string | `equipment`、`user`、`reservation`、`room_reservation`、`maintenance_record` 或 `procurement_record` |
| entity_id | string | 被操作业务对象的标识；对象删除后仍保留 |
| action | string | `实体.动作` 形式的操作代码 |
| summary_json | JSON text | 经过敏感字段过滤的业务前后摘要或删除数量 |
| created_at | ISO datetime | 操作时间 |

审计写入与对应业务变更处于同一事务。`summary_json` 不保存密码、密码哈希、盐值、会话令牌或临时密码。`GET /api/audit-logs` 对 member 仅返回 `actor_user_id` 为本人的记录，对 admin 与 developer 返回全部记录。
