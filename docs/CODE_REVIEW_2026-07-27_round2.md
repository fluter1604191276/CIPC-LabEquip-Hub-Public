# CIPC LabEquip Hub 第二轮审查报告

日期：2026-07-27
范围：第二轮聚焦第一轮未结构性覆盖的角度 —— 产品/UX、性能与规模、代码健康度、领域完整性。所有发现已与第一轮 74 条去重，仅列新问题。

代码规模（自第一轮后已显著增长）：
- apps/api/lib/database.mjs 188 → **562 行**（新增会议室、维修记录、采购记录、schema 迁移与触发器）
- apps/api/lib/service.mjs 323 → **880 行**
- apps/api/server.mjs 161 → **332 行**
- apps/web/app.js 632 → **1507 行**
- apps/web/index.html 367 → **454 行**

统计：39 条新发现（高 8 / 中 21 / 低 10）。全部经独立事实核查 agent 逐条打开文件核实。

> 说明：无障碍（accessibility）深审单独补跑（聚焦对比度 + 键盘 + 焦点），8 条发现已纳入下方。

---

## 最优先（High）

### 1. 设备增删改 API 与 UI 双双无角色门禁，普通 member 可删除任意设备
`apps/api/server.mjs:221`（POST/PATCH/DELETE /api/equipment 均只 `requireUser(request)` 无 roles）
前端 `app.js:782` `canManageEquipment` 对 member 也为真；`index.html:357` 移除设备按钮无角色判断，任意登录用户经 `window.confirm` 即真实执行 DELETE。这是破坏性操作前后端都缺鉴权，区别于第一轮的“输入信任”类问题。
**修复**：equipment 的 POST/PATCH/DELETE 增加 `roles: ["developer","admin"]`；前端 member 视图隐藏新增/删除入口。

### 2. custodian 角色在前端完全未定义，持该角色用户被静默降级为 member
`apps/web/app.js:6-10` `roleDefinitions` 只有 developer/admin/member；`applyRoleView`（约 :755）对 `roleDefinitions[custodian]` 求值为 undefined，直接降级 member 且无任何提示。而后端 20 个种子账号全部是 custodian —— 意味着**所有真实保管人登录后都被降级**。`roleGuideContent` 同样缺 custodian 条目。
**修复**：补齐 custodian 的 `roleDefinitions` 与 `roleGuideContent`；至少在无匹配角色时提示而非静默降级。

### 3. 设备录入后无法编辑任何业务字段
`apps/web/app.js:1278-1307` 设备抽屉唯一表单 `equipment-status-form` 只发送 `status`；`server.mjs:228` 的 PATCH 也只处理 status。name/code/metric/lab/owner 录错后只能删除重建。区别于第一轮“icon/thumb 写死”（那是单字段），此条是全部业务字段不可编辑。
**修复**：扩展 PATCH /api/equipment/:id 支持业务字段，抽屉增加“编辑信息”入口。

### 4. 登录用户无任何自助改密入口
`apps/web/app.js`（登录 submit 与 initializeApp 中）改密逻辑仅在 `mustChangePassword === true` 时触发。首登改密后，侧边栏只有帮助/角色切换/退出登录，再无改密入口。后端 `/api/auth/change-password`（server.mjs:142）完全可用但前端永不再调用。
**修复**：侧边栏用户区加“修改密码”，复用现有 `password-change-form`。

### 5. 搜索输入无 debounce，逐键触发全量过滤 + innerHTML 全替换
`apps/web/app.js:1008/1009/1014/…` 四处 input 事件直接调用渲染函数。`renderDirectory` 每次按键对全量设备做 5 列 `toLowerCase+includes` 后 innerHTML 全替换；500 台设备时单次约 2500 次字符串比较 + 整表重排，中文输入法拼音阶段连续放大。
**修复**：四个搜索框加 150–200ms debounce（`setTimeout`/`clearTimeout`，约 10 行，无需引库）。

### 6. renderAll() 任意单次数据变更重建全部 8 个视图
`apps/web/app.js:599`（partially：视图数量以实际为准）任何一次数据变化触发所有视图同步重建，随数据量与视图数放大。
**修复**：按受影响的数据域局部重渲染，而非全量 renderAll。

### 7. listMaintenanceRecords / listProcurementRecords 无 LIMIT，全量返回
`apps/api/lib/service.mjs:576/622` 无分页无上限，记录随时间无限增长后一次性返回。
**修复**：加分页（LIMIT/OFFSET 或游标），默认上限。

### 8. 维修记录同步触发器仅在 status='available' 时生效，设备可同时“有活跃预约 + 有活跃维修”
`apps/api/lib/database.mjs:204-211` 触发器 WHERE 末尾 `AND status='available'`。disabled/retired（可经 updateEquipmentStatus 合法写入）的设备插入 open/in_progress 维修记录时状态不变，随后 `equipment_prevent_active_maintenance_override` 触发器又阻止恢复 available —— 设备被“卡死”，且 service 层 :527-534 检测到活跃维修记录也无法改回可用。
**修复**：触发器改为不限源状态、无条件置 maintenance；或在 createMaintenanceRecord 中校验设备有活跃预约时禁止建维修记录。

---

## 中优先（Medium，21 条）

### 领域完整性 / 状态机
- **procurement_records.equipment_id schema 可空但服务层强制非空**（database.mjs:246 vs service.mjs:634）：先采购后建档的设计意图被封死。两层需统一。
- **equipment.status='reserved' 是僵尸状态**（database.mjs:112 CHECK 允许 / service.mjs:5 Set 不含 / 启动时 :513-515 无条件静默清除）。三层定义互相矛盾。建议迁移删除该枚举值或补齐写入路径。
- **updateMaintenanceRecordStatus 无状态转换校验**（service.mjs:613-619）：允许 completed→open 回退，触发设备状态异常链，最终设备卡在 maintenance 无法恢复。需合法转换矩阵（completed 为终态）。
- **updateProcurementRecordStatus 无状态转换校验**（service.mjs:659-665）：accepted↔rejected↔pending 可无限互转，财务语义上不应允许。终态应锁定。
- **cancel* 中 admin 无法取消他人预约**（service.mjs:872 及 851）：权限判断只放行 developer，admin 与 member 等同，与 resetUserPassword 等管理功能的权限分层不一致。改为放行 developer/admin。
- **room_reservations 初始 exec 缺 no_overlap_update 触发器**（database.mjs:174-186，partially）：仅在迁移中补齐，迁移失败则 UPDATE 可绕过防重叠。注：核查指出 reservations 表同样如此，两表对称，均建议在初始 exec 补 update 触发器。

### 产品 / UX
- **通知铃铛是死按钮**（index.html:110）：带徽标样式暗示有通知，app.js 无任何监听。短期设为 disabled 或移除。
- **Toast 成功与失败都显示绿色 ✓**（index.html:451 + showToast 无 type 参数）：预约成功与保存失败视觉相同。showToast 加 type(success/error/info)。
- **新建成员初始密码仅靠 3.2 秒 Toast 传达**（app.js:1175）：批量创建时被下一条覆盖，且与密码重置的“持久展示 + 复制按钮”不一致。参照重置流程持久展示。
- **普通用户无“我的预约”列表**（app.js:175-181 只显示今日、不按 requester 过滤）：用户无法查询自己的 pending 申请或历史。增加按 currentUser.id 过滤的面板。

### 性能 / 规模（索引缺失）
- **equipment.status 无索引**（database.mjs:104 区）：按状态过滤全表扫描。
- **listEquipment `ORDER BY created_at, code` 无复合索引**：每次 filesort。
- **reservations.reservation_date 无独立索引**（database.mjs:138 区）：date-only 过滤全表扫描。
- **搜索 LIKE 前导通配符 5 列 OR**（service.mjs:475 区）：全部无法走索引（性能视角；第一轮已从“通配符转义正确性”角度提过，此处是性能维度）。
> 索引建议：`equipment(status)`、`equipment(created_at, code)`、`reservations(reservation_date)`；搜索若量大改用 FTS5 或前缀匹配。

### 代码健康度
- **mapEquipment.updated 永远返回「刚刚」**：死字段，永久失真，前端显示的“更新时间”无意义。改为用真实 updatedAt。
- **会话有效期定义两份**：service 层 12h 常量 vs cookie `Max-Age`（=43200）各自独立，改一处会漂移。抽单一常量。
- **statusLabels 中文映射前后端各维护一份**：状态文案改动需同步两处。由后端统一下发或共享。
- **cancelReservation 与 cancelRoomReservation 结构逐行重复**（service.mjs:839-856 / 858-878）：任何逻辑修复必须改两份。抽公共实现，表名/错误码前缀参数化。
- **createReservation 与 createRoomReservation 约 60 行日期时间校验完全重复**（service.mjs:691-710 / 788-804）：抽公共校验函数。

---

## 低优先（Low，10 条）

- **预约表单不校验 end > start（前端）**（app.js:1025-1058 只校验晚于当前）：错误仅由 API 以 toast 返回，字段无内联提示。加 change 联动 min + 提交前检查。
- **sessions 过期行仅登录时清理**（service.mjs:315 区）：长期无人登录则无限堆积。加定期清理或按需惰性清理。
- **nginx 静态资源无缓存头**（deploy/vps/nginx.conf:30，partially）：app.js/styles.css 每次重新下载。加 Cache-Control + 文件名哈希。
- **reservation_date 存北京时间日期、start_at 存 UTC**（service.mjs:703-706）：00:00–07:59 时段两字段隐含日期不同，按不同字段查询会得出不同日期归属。写入路径一致故当前无冲突，建议文档化或统一派生。
- **removeEquipment 对任何历史记录（含全 cancelled/completed）一律阻止删除**（service.mjs:557-565）：规则过严且错误信息无说明。要么文档化“有历史即永久保留”，要么只对活跃态记录阻止删除。
- **[developer,admin] 管理员数组多处内联**（server.mjs/service.mjs，partially）：抽命名常量。
- **月份名称数组在 app.js 两处独立定义**：不同调用路径可能不一致。合并为一处。
- **人数上限 12 硬编码三处**（schema CHECK、service 校验、前端 HTML，partially）：抽单一常量/配置。
- **initializeApp 清理已不存在的 demo localStorage key**（partially）：死代码，可删。
- **icon/thumb 默认值客户端与服务端各定义一份**（partially）：默认值应单一来源。

---

## 建议的处理顺序（承接第一轮）

1. **鉴权缺口最紧急**：设备 POST/PATCH/DELETE 加角色门禁（第 1 条）—— 这是本轮唯一的“任意用户可破坏数据”问题，应与第一轮的账号抢注一起最先处理。
2. **custodian 降级**（第 2 条）：影响所有真实保管人账号，几行修复。
3. **状态机三件套**（维修/采购状态转换校验 + reserved 僵尸态 + 维修同步触发器）：随功能已上线，越晚改数据越乱。
4. **性能索引 + 搜索 debounce**：数据量还小的现在加最省事，四行 CREATE INDEX + 10 行 debounce。
5. **代码去重**（cancel*/create* 双份、映射表两处）：在加更多功能前收敛，否则重复面持续扩大。
6. UX 打磨（改密入口、我的预约、toast 语义、死按钮）按需排期。

如需，我可以直接动手处理第 1、2 条（鉴权 + custodian），这两条影响面最大且改动很小。

---

## 无障碍（a11y）— 聚焦审查，8 条（全部经实测对比度数值核实）

### 🔴 高

**主按钮/登录按钮白字配橙底对比度仅 2.68:1**
`apps/web/styles.css:444-448`（`.primary-button`）
背景 `--orange #ed7d55`，前景 `#fff`，字号 12px（非大文本，AA 要求 4.5:1）。实测对比度约 2.68:1，hover 色 `#dc6e48`（:451）更深更低。该样式被**全站所有"提交/新建预约/新增设备/登录"按钮**复用，是最高频操作，全部不达标。对比：`.danger-button #bd4e57` 白字实测约 4.86:1 通过，问题集中在橙色主按钮。
**修复**：背景加深到 `#c85a34` 级别（约 4.6:1），hover 态一并调整。

**搜索框清除 `outline` 且无任何替代焦点样式**
`apps/web/styles.css:614-621`（`.search-box input`）
`outline: none` 且整个文件中未见针对该元素的 `:focus` / `:focus-visible` 替代样式，键盘用户 Tab 到四个搜索框时完全无视觉反馈。对比：`.modal input:focus`（:1183）和 `.directory-select select:focus-visible`（:1473）均有 `box-shadow` 焦点环，属不一致疏漏。违反 WCAG 2.4.7。
**修复**：给 `.search-box:focus-within` 或 `.search-box input:focus` 加 `border-color + box-shadow` 焦点环。

### 🟡 中

**状态徽章（`status-available`/`status-reserved` 等）9px 小字对比度不足**
`apps/web/styles.css:707-742`
字号 9px，`font-weight 600`。实测：绿字 `#2aa879` on `--green-light #eaf8f2` ≈ 2.75:1；蓝字 `#4e8bd9` on `--blue-light #edf4fd` ≈ 3.30:1；均低于 4.5:1。同色系还用于预约状态标签。
**修复**：加深文字色（绿 `#1c7a56`、蓝 `#2f6cbf` 可达 4.5:1）。

**模态/通知关闭按钮 × 图标对比度仅 2.44:1**
`apps/web/styles.css:1154-1157`（`.close-modal`）和 `:362-365`（`.notification-close`）
颜色 `#9da6b2` on 白底，图形元素需 ≥3:1（WCAG 1.4.11），实测 2.44:1。`.close-guide-modal`（:2820）`#8e98a5` 同样低。低视力鼠标用户难以辨识关闭入口。
**修复**：关闭图标色加深到约 `#6b7480`（≥3:1）。

**搜索框 placeholder 文本对比度仅 2.23:1**
`apps/web/styles.css:622-624`
`#a7aeb8` on 白底，字号 10px，实测 2.23:1 < 4.5:1。搜索框以 placeholder 承载唯一的功能说明（"按设备名、资产编号…搜索"），低视力用户无法读到提示范围。
**修复**：至少加深到 `#6e7887`（≈4.5:1），或在框外加持久说明文字。

**角色切换 listbox 声明了 ARIA 语义但无键盘导航，`option` 用 `button` 承载**
`apps/web/index.html:89-94`
外层 `div[role=listbox]`，三个子 `<button role="option" aria-selected>`。`role=option` 挂在交互 `<button>` 上是无效的角色/元素组合（WAI-ARIA 规范不允许）；listbox 内读屏期望方向键漫游 + `aria-activedescendant`，但 app.js 只在打开时 focus 当前项（:758），无 Arrow 键处理。
**修复**：要么去掉 listbox/option 语义改用普通弹出菜单（`role=menu`/`menuitem`），要么补齐方向键 roving + 改选项为 `div[role=option]`。

### 🟢 低

**筛选切换按钮未暴露选中状态（无 `aria-pressed`）**
`apps/web/index.html:159-162`（`.filter-pill` 按钮组）
纯 CSS 高亮表示"当前筛选"，读屏无法感知当前选中。对比：日历 tab 组用了 `aria-selected`（:210），不一致。
**修复**：加 `aria-pressed="true/false"`，随点击同步更新；或改用 `role=radio` 单选组。

**缺少跳转到主内容的 skip link（违反 WCAG 2.4.1）**
`apps/web/index.html:50-103`（`.sidebar` 先于 `.main-content`）
键盘 Tab 必须穿越全部侧边导航才能到达工作区，无跳过链接。`.visually-hidden` 工具类（styles.css:3255）已存在可复用。
**修复**：在 body 起始处加 `<a href="#main" class="visually-hidden">跳至主内容</a>`，给 `main.main-content` 加 `id="main" tabindex="-1"`。
