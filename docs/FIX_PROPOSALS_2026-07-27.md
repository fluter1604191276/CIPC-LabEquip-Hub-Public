# 修复方案 — 第二轮高危/关键项（2026-07-27）

> 本文只给方案与 diff 草案，**未改动任何源码**。每条标注证据位置、根因、建议改法、影响面与验证方式。
> 代码位置基于当前状态（server.mjs 332 行、service.mjs 880 行、database.mjs 562 行、app.js 1507 行）。

---

## 修复前必读：第一轮部分高危已被你修掉

读当前代码时确认，以下第一轮发现**已在后续开发中解决**，本轮不再重复：

- **畸形 Host 头崩溃进程** → 已修：[server.mjs:105](apps/api/server.mjs#L105) 改为 `new URL(request.url || "/", "http://localhost")`，不再拼接 Host 头。
- **登录无限流** → 已修：新增 `createLoginLimiter`（[server.mjs:56](apps/api/server.mjs#L56)），按 IP+用户名 15 分钟 5 次失败锁定。
- **畸形 Cookie 导致 500** → 已修：`parseCookies` 已加 try/catch（[server.mjs:43](apps/api/server.mjs#L43)）。
- **HTTP 层不可测** → 已修：抽出了 `createApp(service, {...})` 工厂（[server.mjs:84](apps/api/server.mjs#L84)），import 不再有副作用。
- **改密后旧会话不失效** → 已缓解：改密后重新签发会话（[server.mjs:146](apps/api/server.mjs#L146)）。

下面是**仍然成立**的高危/关键项。

---

## 1. 【高】设备删除接口无角色门禁 — 任意 member 可删任意设备

**证据**：[server.mjs:234-238](apps/api/server.mjs#L234) 的 `DELETE /api/equipment/:id` 只调 `requireUser(request)`，无 `roles`。前端 `canManageEquipment` 对 member 也为 true，抽屉"移除设备"按钮无角色判断。

**关键区分**：member 的 `POST /api/equipment`（新增）**可能是有意的** —— 成员指南 [app.js:14](apps/web/app.js#L14) 明确写"需要时可新增设备"。所以本条**只主张收紧破坏性操作**（DELETE，PATCH 视策略），不动 POST，除非你确认新增也该限权。

**建议改法**（后端，最小改动，复用已有的 `roles` 机制）：

```diff
  const equipmentMatch = url.pathname.match(/^\/api\/equipment\/([^/]+)$/);
  if (request.method === "PATCH" && equipmentMatch) {
-   requireUser(request);
+   requireUser(request, { roles: ["developer", "admin"] });
    sendJson(response, 200, { data: service.updateEquipmentStatus(decodeURIComponent(equipmentMatch[1]), await readJson(request)) }, corsHeaders);
    return;
  }

  if (request.method === "DELETE" && equipmentMatch) {
-   requireUser(request);
+   requireUser(request, { roles: ["developer", "admin"] });
    sendJson(response, 200, { data: service.removeEquipment(decodeURIComponent(equipmentMatch[1])) }, corsHeaders);
    return;
  }
```

**前端配套**（隐藏 member 的删除入口，避免点了才报 403）：在渲染设备抽屉 footer 的"移除设备"按钮处，用 `["developer","admin"].includes(currentUser.role)` 判断是否渲染/禁用。注意判断依据要用 **`currentUser.role`（真实角色）**，不是 `currentRole`（开发者可切换的视图角色）。

**影响面**：member 将无法删除/改状态设备；若你希望 custodian（设备保管人）能管理自己负责的设备，需要更细的"按 owner 归属"授权 —— 那是另一个功能，不在本次最小修复内。

**验证**：以 member 会话 `curl -X DELETE /api/equipment/<id>` 应得 403 FORBIDDEN；developer/admin 仍可删。

---

## 2. 【高】维修触发器令非 available 设备卡死在不可恢复状态

**证据**：[database.mjs:204-211](apps/api/lib/database.mjs#L204) 的 `maintenance_records_sync_equipment_insert` 带 `WHERE ... AND status = 'available'`。对 `disabled`/`retired` 设备插入 `open`/`in_progress` 维修记录时，设备状态**原地不动**；随后 [database.mjs:233-243](apps/api/lib/database.mjs#L233) 的 `equipment_prevent_active_maintenance_override` 又会 `RAISE(ABORT)` 阻止把它改回 `available`，且 [service.mjs:527-534](apps/api/lib/service.mjs#L527) 也会抛 `EQUIPMENT_HAS_ACTIVE_MAINTENANCE`。结果：设备被一条活跃维修记录锁死，除非手动把该记录改成 completed。

**根因**：同步触发器假设"设备当前是 available"，但设备可以是 disabled/retired。真正的问题是**是否允许给 disabled/retired 设备开维修单**这个语义没定义。

**两个方向，二选一**：

**方向 A（推荐，语义最干净）**——在服务层禁止给已停用/报废设备开活跃维修单，从源头杜绝矛盾态。在 `createMaintenanceRecord`（[service.mjs:587](apps/api/lib/service.mjs#L587)）里加前置校验：

```diff
  createMaintenanceRecord(input, actor = {}) {
    const equipmentId = requiredText(input.equipmentId, "设备");
    const equipment = database.prepare("SELECT * FROM equipment WHERE id = ?").get(equipmentId);
    if (!equipment) throw new AppError(404, "EQUIPMENT_NOT_FOUND", "没有找到对应设备");
+   const status = requiredEnum(input.status, "记录状态", maintenanceStatuses);
+   if (["disabled", "retired"].includes(equipment.status) && ["open", "in_progress"].includes(status)) {
+     throw new AppError(409, "EQUIPMENT_NOT_SERVICEABLE", "设备已停用或报废，无法登记进行中的维修记录");
+   }
    // ...原有逻辑
```

**方向 B（触发器兜底，改动最小但语义更宽松）**——让同步触发器对"可维修"的源状态都生效，不只 available。即把 [database.mjs:210](apps/api/lib/database.mjs#L210) 的 `AND status = 'available'` 放宽为 `AND status NOT IN ('retired')`（报废设备不再动），insert 与 update 两个触发器都要改：

```diff
  UPDATE equipment
  SET status = 'maintenance', updated_at = NEW.updated_at
- WHERE id = NEW.equipment_id AND status = 'available';
+ WHERE id = NEW.equipment_id AND status NOT IN ('maintenance', 'retired');
```

方向 B 会让 disabled 设备在开维修单时自动转 maintenance，回收时再回到 available —— 但这改变了 disabled 的语义（停用设备被维修单"复活"成维修中），需你确认是否符合业务预期。**若拿不准，选 A。**

**注意迁移**：触发器改动要走你已有的迁移机制（database.mjs 里有 `schema_migrations`），用 `DROP TRIGGER IF EXISTS ... ; CREATE TRIGGER ...` 覆盖，不能只改初始 exec（老库不会重建触发器）。

**验证**：建一台设备→改 disabled→开一条 in_progress 维修单→确认不再卡死（方向 A：直接被拒；方向 B：设备转 maintenance 且可随记录完成而恢复）。

---

## 3. 【高】custodian 角色前端未定义 — 20 个真实账号登录后被静默降级为 member

**证据**：[app.js:6-10](apps/web/app.js#L6) 的 `roleDefinitions` 只有 developer/admin/member。[app.js:777](apps/web/app.js#L777) `roleDefinitions[currentUser?.role] ? currentUser.role : "member"` —— custodian 不在表中→降级 member，无任何提示。种子里 20 个 custodian 账号（真实保管人）全部命中。

**建议改法**：给 custodian 一个明确定义。设备保管人的职责比普通用户重（要管设备、维修、采购），比 admin 轻（不碰成员账号）。建议视图去掉 `members`：

```diff
  const roleDefinitions = {
    developer: { label: "开发者权限", avatar: "D", views: [...], guideSections: [...] },
    admin: { label: "系统管理员", avatar: "管", views: [...], guideSections: [...] },
+   custodian: { label: "设备保管人", avatar: "保", views: ["overview", "equipment", "calendar", "meeting-rooms", "maintenance", "records"], guideSections: ["start", "equipment", "reservation", "records", "faq"] },
    member: { label: "普通用户", avatar: "用", views: [...], guideSections: [...] }
  };
```

并在 `roleGuideContent`（[app.js:11](apps/web/app.js#L11)）补 `custodian` 条目（可先复制 member 的文案改标题，后续细化）。

**与第 1 条的关系**：如果第 1 条把设备管理限到 `["developer","admin"]`，而 custodian 才是真正的设备保管人 —— 建议把设备管理权限改成 `["developer","admin","custodian"]`，让保管人能管设备、member 不能。这需要你先定清楚"谁能管设备"这条产品规则，两处（后端 roles、前端 canManageEquipment）保持一致。

**验证**：以某个 custodian 账号登录，确认顶部角色显示"设备保管人"而非"普通用户"，且导航/入口符合预期。

---

## 4. 【中】admin 无法取消他人预约（权限分层不一致）

**证据**：[service.mjs:883](apps/api/lib/service.mjs#L883) `actor?.role !== "developer" && reservation.requester_user_id !== actor?.id` —— 只有 developer 能越权取消，admin 与 member 同权。房间预约同样（cancelRoomReservation）。而 `resetUserPassword` 等管理操作是 `["developer","admin"]`，不一致。

**建议改法**（两处对称修改）：

```diff
- if (actor?.role !== "developer" && reservation.requester_user_id !== actor?.id) {
+ if (!["developer", "admin"].includes(actor?.role) && reservation.requester_user_id !== actor?.id) {
    throw new AppError(403, "RESERVATION_CANCEL_FORBIDDEN", "只能取消自己提交的预约");
  }
```

**关联重构**：cancelReservation 与 cancelRoomReservation 是逐行重复的两份（code-health 已报），这个权限判断在两处都要改 —— 正是"改一处漏一处"的典型。建议顺手把权限判断抽成 `canCancel(actor, requesterUserId)` 小函数，两处共用。

**验证**：admin 会话取消他人 approved 预约应成功；member 取消他人预约仍应 403。

---

## 5. 【高】登录后无自助改密入口

**证据**：改密表单仅在 `mustChangePassword===true` 时进入。主界面侧边栏（[index.html](apps/web/index.html) 用户区）只有退出登录，无"修改密码"入口。后端 `/api/auth/change-password`（[server.mjs:142](apps/api/server.mjs#L142)）一直可用。

**建议改法**（复用已有 UI 与接口，改动集中在前端）：
1. 在侧边栏用户区加一个"修改密码"按钮/菜单项。
2. 点击后复用现有的 `password-change-form`（它现在只在首登流程用），弹出为独立模态；提交仍调 `POST /api/auth/change-password`。
3. 与首登流程的区别：首登是强制、不可关闭；自助改密可取消关闭。可给该表单加一个 `mode` 状态区分"强制/自助"，控制是否显示关闭按钮和标题文案。

因为涉及新增 UI 结构，diff 比前几条大，建议实现时单独一个 commit。核心接口无需改动。

**验证**：已改过初始密码的账号，能从侧边栏发起改密并成功；错误当前密码应报 `CURRENT_PASSWORD_INVALID`。

---

## 建议提交顺序

1. **第 1 条**（设备 DELETE/PATCH 加 roles）+ **第 3 条**（custodian 角色）—— 一起做，因为"谁能管设备"这条规则同时决定这两处的角色数组。先定规则：`["developer","admin","custodian"]` 还是 `["developer","admin"]`。
2. **第 2 条**（维修触发器，走迁移）—— 独立 commit，需要你在方向 A / B 之间拍板（推荐 A）。
3. **第 4 条**（admin 取消权限）+ 抽 `canCancel` —— 顺带消一处重复。
4. **第 5 条**（自助改密 UI）—— 独立 commit，改动偏 UI。

每条都可独立验证、独立回滚。除第 2 条涉及 schema 迁移需谨慎外，其余都是低风险改动。
