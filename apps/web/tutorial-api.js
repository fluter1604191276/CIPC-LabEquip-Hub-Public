(() => {
  "use strict";
  // Deliberately self-contained: this adapter has no network, storage, or browser dependencies.
  const clone = value => JSON.parse(JSON.stringify(value));
  const fail = (message, status = 400, code = "TUTORIAL_VALIDATION_ERROR") => {
    throw Object.assign(new Error(message), { status, code });
  };
  const text = (value, label, max = 500) => {
    if (typeof value !== "string" || !value.trim() || value.trim().length > max) fail(`请填写有效的${label}`);
    return value.trim();
  };
  const choice = (value, choices, label) => choices.includes(value) ? value : fail(`请选择有效的${label}`);
  function dateValue(value) {
    if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) fail("请选择有效日期");
    const parsed = new Date(`${value}T12:00:00Z`);
    if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) fail("请选择有效日期");
    return value;
  }
  function amount(value) {
    if (value === "" || value == null || typeof value === "boolean" || !Number.isFinite(Number(value)) || Number(value) < 0) fail("金额需要为零或正数");
    return Number(value);
  }
  function create({ role = "member", values = {}, lessonId = "", stepIndex = 0 } = {}) {
    role = ["member", "admin", "developer"].includes(role) ? role : "member";
    values = clone(values);
    const now = new Date().toISOString();
    const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 1);
    const tomorrowDate = `${tomorrow.getFullYear()}-${String(tomorrow.getMonth() + 1).padStart(2, "0")}-${String(tomorrow.getDate()).padStart(2, "0")}`;
    const currentUser = { id: "demo-user", username: "demo01", displayName: "演示同学", role, laboratoryId: "demo-lab", laboratoryName: "光电实验室", mustChangePassword: false, createdAt: now, updatedAt: now };
    const equipment = [
      { id: "scope", name: "数字示波器", code: "DEMO-001", metric: "100 MHz / 4 通道", icon: "∿", thumb: "thumb-orange", status: "available" },
      { id: "meter", name: "数字万用表", code: "DEMO-002", metric: "6½ 位 / 多功能测量", icon: "⌁", thumb: "thumb-blue", status: "available" },
      { id: "laser", name: "激光功率计", code: "DEMO-003", metric: "400–1100 nm / 10 mW", icon: "◇", thumb: "thumb-green", status: "maintenance" }
    ].map(item => ({ ...item, lab: "光电实验室", laboratoryId: "demo-lab", location: "教学楼 201", owner: "演示老师", createdAt: now, updatedAt: now }));
    const ownBaseline = ["orientation", "cancel"].includes(lessonId);
    const data = {
      currentUser, equipment,
      laboratories: [{ id: "demo-lab", name: "光电实验室", code: "DEMO-LAB", alias: "光电教学空间", sortOrder: 1, active: true, createdAt: now, updatedAt: now }],
      meetingRooms: [{ id: "room-a", name: "研讨室 A", code: "ROOM-A", capacity: 8, location: "教学楼 201", active: true, createdAt: now, updatedAt: now }],
      reservations: [], roomReservations: [], maintenanceRecords: [], procurementRecords: [],
      users: [currentUser], auditLogs: [],
      updateStatus: { state: "idle", currentVersion: "0.0.1", message: "演示模式：暂无升级任务，不执行真实备份或部署。" }
    };
    data.reservations.push({
      id: "demo-booking", equipmentId: ownBaseline ? "scope" : "meter", equipmentName: ownBaseline ? "数字示波器" : "数字万用表", equipmentCode: ownBaseline ? "DEMO-001" : "DEMO-002",
      date: tomorrowDate, start: "14:00", end: "15:00", startAt: new Date(`${tomorrowDate}T14:00:00+08:00`).toISOString(), endAt: new Date(`${tomorrowDate}T15:00:00+08:00`).toISOString(),
      people: 1, purpose: "课程实验练习", requesterName: ownBaseline ? currentUser.displayName : "演示老师", requesterLab: currentUser.laboratoryName, requesterUserId: ownBaseline ? currentUser.id : "demo-teacher",
      status: lessonId === "cancel" && stepIndex >= 2 ? "cancelled" : "approved", createdAt: now, updatedAt: now
    });
    const manager = () => { if (!["admin", "developer"].includes(role)) fail("本练习操作需要管理员角色", 403, "TUTORIAL_FORBIDDEN"); };
    const developer = () => { if (role !== "developer") fail("本练习操作需要开发者角色", 403, "TUTORIAL_FORBIDDEN"); };
    const find = (collection, id) => collection.find(item => item.id === id) || fail("未找到演示记录", 404, "TUTORIAL_NOT_FOUND");
    const nextId = (collection, base) => collection.some(item => item.id === base) ? `${base}-${collection.length + 1}` : base;
    function addReservation(input, room) {
      const collection = room ? data.roomReservations : data.reservations;
      const resource = find(room ? data.meetingRooms : data.equipment, room ? input.meetingRoomId : input.equipmentId);
      if (room ? !resource.active : resource.status !== "available") fail("该演示资源当前未开放预约", 409);
      const date = dateValue(input.date);
      const start = text(input.start, "开始时间"), end = text(input.end, "结束时间");
      if (![start, end].every(value => /^([01]\d|2[0-3]):[0-5]\d$/.test(value)) || end <= start) fail("结束时间需要晚于开始时间");
      const startAt = new Date(`${date}T${start}:00+08:00`).toISOString(), endAt = new Date(`${date}T${end}:00+08:00`).toISOString();
      if (Date.parse(startAt) <= Date.now()) fail("预约开始时间需要晚于当前时间");
      const people = Number(input.people);
      if (!Number.isInteger(people) || people < 1 || people > (room ? resource.capacity : 12)) fail(`人数需要在 1 到 ${room ? resource.capacity : 12} 人之间`);
      const key = room ? "meetingRoomId" : "equipmentId";
      if (collection.some(item => item[key] === resource.id && item.status !== "cancelled" && item.startAt < endAt && item.endAt > startAt)) fail("该资源在所选时段已有演示预约", 409, "TUTORIAL_RESERVATION_CONFLICT");
      const record = {
        id: nextId(collection, room ? "practice-room" : "practice-booking"), date, start, end, startAt, endAt, people, purpose: text(input.purpose, "使用用途"),
        ...(room ? { meetingRoomId: resource.id, meetingRoomName: resource.name, meetingRoomCode: resource.code } : { equipmentId: resource.id, equipmentName: resource.name, equipmentCode: resource.code }),
        requesterName: currentUser.displayName, requesterLab: currentUser.laboratoryName, requesterUserId: currentUser.id, status: "approved", createdAt: now, updatedAt: now
      };
      collection.push(record); return record;
    }
    function addEquipment(input) {
      const name = text(input.name, "设备名称", 200);
      const code = text(input.code, "资产编号", 80).toUpperCase();
      const metric = text(input.metric, "性能指标", 500);
      const lab = text(input.lab, "所在实验室", 200);
      const laboratory = data.laboratories.find(item => item.name === lab && item.active);
      if (!laboratory) fail("请选择已启用的演示实验室");
      const owner = text(input.owner, "设备保管人", 200);
      const status = choice(input.status || "available", ["available", "maintenance", "disabled", "retired"], "初始状态");
      if (data.equipment.some(item => item.code.toUpperCase() === code)) fail("演示资产编号已存在", 409);
      const result = { id: nextId(data.equipment, "practice-equipment"), name, code, metric, lab, laboratoryId: laboratory.id, location: text(input.location || lab, "所在实验室", 200), owner, status, icon: "◇", thumb: "thumb-orange", createdAt: now, updatedAt: now };
      data.equipment.push(result);
      return result;
    }
    function addRecord(input, procurement) {
      const resource = find(data.equipment, input.equipmentId);
      const record = {
        id: nextId(procurement ? data.procurementRecords : data.maintenanceRecords, procurement ? "practice-procurement" : "practice-maintenance"),
        equipmentId: resource.id, equipmentName: resource.name, equipmentCode: resource.code, date: dateValue(input.date),
        createdByUserId: currentUser.id, createdByName: currentUser.displayName, createdAt: now, updatedAt: now
      };
      if (procurement) {
        Object.assign(record, { vendor: text(input.vendor, "供应商"), amount: amount(input.amount), status: choice(input.status, ["pending", "accepted", "rejected"], "验收状态"), notes: String(input.notes || "").slice(0, 2000) });
        data.procurementRecords.unshift(record);
      } else {
        Object.assign(record, { type: choice(input.type, ["repair", "maintenance"], "维护类型"), status: choice(input.status, ["open", "in_progress", "completed"], "处理状态"), cost: amount(input.cost), description: text(input.description, "维护说明", 2000) });
        data.maintenanceRecords.unshift(record);
        refreshEquipmentStatus(resource.id);
      }
      return record;
    }
    function refreshEquipmentStatus(id) {
      const resource = find(data.equipment, id);
      resource.status = data.maintenanceRecords.some(item => item.equipmentId === id && item.status !== "completed") ? "maintenance" : "available";
      resource.updatedAt = now;
      data.maintenanceRecords.filter(item => item.equipmentId === id).forEach(item => { item.equipmentStatus = resource.status; });
    }
    function saveLaboratory(input, id) {
      manager();
      const existing = id ? find(data.laboratories, id) : null;
      const name = text(input.name, "实验室名称", 100), code = text(input.code, "实验室编号", 40), alias = String(input.alias || "").trim();
      const sortOrder = Number(input.sortOrder ?? existing?.sortOrder ?? data.laboratories.length + 1);
      if (!Number.isInteger(sortOrder) || sortOrder < 0 || sortOrder > 999999) fail("排序需要为 0–999999 的整数");
      if (data.laboratories.some(item => item.id !== id && (item.code === code || item.name === name))) fail("演示实验室名称或编号已存在", 409);
      if (input.active !== undefined && typeof input.active !== "boolean") fail("请选择有效的启用状态");
      const result = { ...(existing || { id: nextId(data.laboratories, "practice-lab"), createdAt: now }), name, code, alias, sortOrder, active: input.active ?? existing?.active ?? true, updatedAt: now };
      if (existing) {
        Object.assign(existing, result);
        data.equipment.filter(item => item.laboratoryId === id).forEach(item => { item.lab = name; });
        data.users.filter(item => item.laboratoryId === id).forEach(item => { item.laboratoryName = name; });
      } else data.laboratories.push(result);
      return result;
    }
    function addUser(input) {
      manager();
      const username = text(input.username, "用户名", 40);
      if (!/^[a-z][a-z0-9]{1,39}$/.test(username)) fail("用户名需为字母开头的 2–40 位小写字母或数字");
      if (data.users.some(item => item.username === username)) fail("演示用户名已存在", 409);
      const userRole = choice(input.role, ["member", "admin"], "账号角色");
      const laboratory = input.laboratoryId ? find(data.laboratories, input.laboratoryId) : null;
      if (laboratory && !laboratory.active) fail("请选择已启用的演示实验室");
      const result = { id: nextId(data.users, "practice-member"), username, displayName: text(input.displayName, "姓名", 100), role: userRole, laboratoryId: laboratory?.id || null, laboratoryName: laboratory?.name || null, mustChangePassword: true, createdAt: now, updatedAt: now };
      data.users.push(result); return result;
    }
    function dispatch(path, method, input) {
      if (typeof path !== "string" || !/^\/[a-z][a-z0-9/?=&%_.-]*$/i.test(path)) fail("演示请求地址未开放", 404, "TUTORIAL_ROUTE_DISABLED");
      const [route, query = ""] = path.split("?");
      const params = Object.fromEntries(query.split("&").filter(Boolean).map(pair => pair.split("=").map(decodeURIComponent)));
      if (method === "GET") {
        if (route === "/auth/session") return data.currentUser;
        const lists = { "/equipment": data.equipment, "/reservations": data.reservations, "/room-reservations": data.roomReservations, "/maintenance-records": data.maintenanceRecords, "/procurement-records": data.procurementRecords };
        if (Object.hasOwn(lists, route)) return lists[route];
        if (route === "/laboratories" || route === "/meeting-rooms") {
          if (params.includeInactive === "true") manager();
          return (route === "/laboratories" ? data.laboratories : data.meetingRooms).filter(item => params.includeInactive === "true" || item.active);
        }
        if (route === "/my-reservations") return [
          ...data.reservations.map(item => ({ ...item, kind: "equipment", resourceType: "equipment", resourceId: item.equipmentId, resourceName: item.equipmentName, resourceCode: item.equipmentCode })),
          ...data.roomReservations.map(item => ({ ...item, kind: "room", resourceType: "meeting_room", resourceId: item.meetingRoomId, resourceName: item.meetingRoomName, resourceCode: item.meetingRoomCode }))
        ].filter(item => item.requesterUserId === currentUser.id);
        if (route === "/users") { manager(); return data.users; }
        if (route === "/audit-logs") {
          manager();
          const page = Math.max(1, Math.floor(Number(params.page) || 1)), pageSize = Math.min(100, Math.max(1, Math.floor(Number(params.pageSize) || 20)));
          return { items: data.auditLogs.slice((page - 1) * pageSize, page * pageSize), pagination: { page, pageSize, total: data.auditLogs.length, totalPages: Math.max(1, Math.ceil(data.auditLogs.length / pageSize)) } };
        }
        if (route === "/update/status") { developer(); return data.updateStatus; }
        if (route === "/update/check") {
          developer();
          return { currentVersion: data.updateStatus.currentVersion, latestVersion: "0.0.2", updateAvailable: data.updateStatus.currentVersion !== "0.0.2", releaseNotes: "【虚拟版本演练】练习检查更新、备份并升级与核对结果。此处不连接版本仓库，不创建真实备份，不执行部署。", checkedAt: now };
        }
      }
      if (method === "POST") {
        if (route === "/equipment") return addEquipment(input);
        if (route === "/reservations" || route === "/room-reservations") return addReservation(input, route === "/room-reservations");
        if (route === "/maintenance-records" || route === "/procurement-records") return addRecord(input, route === "/procurement-records");
        if (route === "/laboratories") return saveLaboratory(input);
        if (route === "/users") return addUser(input);
        if (route === "/update") {
          developer();
          if (input.version !== "0.0.2") fail("请先检查虚拟更新版本");
          data.updateStatus = { state: "completed", currentVersion: "0.0.2", targetVersion: "0.0.2", completedAt: now, message: "演示升级已完成（模拟）：虚拟备份、测试、切换与健康检查通过，真实系统保持原状。" };
          return data.updateStatus;
        }
      }
      if (method === "PATCH") {
        const cancel = /^\/(reservations|room-reservations)\/([a-z0-9-]+)\/cancel$/.exec(route);
        if (cancel) {
          const record = find(cancel[1] === "reservations" ? data.reservations : data.roomReservations, cancel[2]);
          if (record.requesterUserId !== currentUser.id && role !== "developer") fail("仅可取消本人演示预约", 403, "TUTORIAL_FORBIDDEN");
          if (record.status !== "cancelled" && (record.status !== "approved" || Date.parse(record.startAt) <= Date.now())) fail("请取消尚未开始的演示预约", 409);
          record.status = "cancelled"; record.updatedAt = now; return record;
        }
        const recordPath = /^\/(maintenance-records|procurement-records)\/([a-z0-9-]+)$/.exec(route);
        if (recordPath) {
          const procurement = recordPath[1] === "procurement-records";
          const record = find(procurement ? data.procurementRecords : data.maintenanceRecords, recordPath[2]);
          record.status = choice(input.status, procurement ? ["pending", "accepted", "rejected"] : ["open", "in_progress", "completed"], "记录状态");
          record.updatedAt = now;
          if (!procurement) refreshEquipmentStatus(record.equipmentId);
          return record;
        }
        const labPath = /^\/laboratories\/([a-z0-9-]+)$/.exec(route);
        if (labPath) return saveLaboratory(input, labPath[1]);
      }
      fail("该操作不在当前虚拟教程开放范围内", 404, "TUTORIAL_ROUTE_DISABLED");
    }
    // Rebuild only completed lesson actions; Back/restart therefore restores earlier virtual state.
    if (values["submit:equipment"]) addEquipment(values["submit:equipment"]);
    if (values["submit:booking"]) addReservation({ ...values["submit:booking"], equipmentId: "scope" }, false);
    if (values["submit:room"]) addReservation({ ...values["submit:room"], meetingRoomId: "room-a" }, true);
    if (values["submit:maintenance"]) { const v = values["submit:maintenance"]; addRecord({ ...v, equipmentId: v.equipment, description: v.notes }, false); }
    if (values["submit:procurement"]) { const v = values["submit:procurement"]; addRecord({ ...v, equipmentId: v.equipment }, true); }
    if (values["accept:procurement"] && data.procurementRecords.length) dispatch("/procurement-records/practice-procurement", "PATCH", values["accept:procurement"]);
    if (values["submit:member"]) { const v = values["submit:member"]; addUser({ displayName: v.name, username: v.username, role: v.role, laboratoryId: v.laboratory }); }
    if (values["submit:lab"]) { const v = values["submit:lab"]; saveLaboratory({ ...v, sortOrder: v.sort }); }
    if (values["submit:lab-edit"]) {
      const v = values["submit:lab-edit"], existing = find(data.laboratories, "practice-lab");
      saveLaboratory({ ...existing, name: v.name, code: v.code ?? existing.code, alias: v.alias ?? existing.alias, sortOrder: v.sort ?? existing.sortOrder, active: v.active === "true" }, "practice-lab");
    }
    if (lessonId === "upgrade" && stepIndex >= 4) dispatch("/update", "POST", { version: "0.0.2" });
    return {
      async request(path, options = {}) {
        const method = String(options.method || "GET").toUpperCase();
        let input = {};
        if (options.body != null) {
          try { input = typeof options.body === "string" ? JSON.parse(options.body) : clone(options.body); }
          catch { fail("演示请求内容格式有误"); }
          if (!input || typeof input !== "object" || Array.isArray(input)) fail("演示请求内容应为对象");
        }
        const result = dispatch(path, method, input);
        if (method !== "GET") data.auditLogs.unshift({ id: `demo-audit-${data.auditLogs.length + 1}`, actorDisplayName: currentUser.displayName, actorUsername: currentUser.username, entityId: result.id || "demo-upgrade", entityType: "tutorial", action: "tutorial.practice", summary: {}, createdAt: now });
        return clone(result);
      },
      snapshot: () => clone(data)
    };
  }
  globalThis.TutorialAPI = Object.freeze({ create });
})();
