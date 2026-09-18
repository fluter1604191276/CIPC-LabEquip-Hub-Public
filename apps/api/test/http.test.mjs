import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { Readable } from "node:stream";
import { createDatabase } from "../lib/database.mjs";
import { AppError, createService } from "../lib/service.mjs";
import { createApp, readJson, resolveCookieSecure } from "../server.mjs";

function futureDate(offsetDays) {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + offsetDays);
  return date.toISOString().slice(0, 10);
}

function todayInShanghai() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date());
}

async function httpFixture(t, options = {}) {
  const database = createDatabase(":memory:");
  const service = createService(database);
  const server = createApp(service, options);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;
  t.after(async () => {
    server.close();
    await once(server, "close");
    database.close();
  });
  return { database, service, server, baseUrl };
}

async function login(baseUrl, username, password, headers = {}) {
  const response = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify({ username, password })
  });
  const payload = await response.json();
  return {
    response,
    payload,
    cookie: response.headers.get("set-cookie")?.split(";", 1)[0] || ""
  };
}

test("decodes a multibyte JSON body after all chunks are collected", async () => {
  const body = Buffer.from(JSON.stringify({ name: "中文设备" }));
  const splitAt = body.indexOf(Buffer.from("中")) + 1;
  const parsed = await readJson(Readable.from([body.subarray(0, splitAt), body.subarray(splitAt)]));
  assert.equal(parsed.name, "中文设备");
});

test("rejects non-object JSON at the HTTP boundary", async (t) => {
  const { baseUrl } = await httpFixture(t);
  const response = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "null"
  });
  assert.equal(response.status, 400);
  assert.equal((await response.json()).error.code, "INVALID_JSON");
});

test("LAN HTTP deployment can opt out of Secure cookies explicitly", async (t) => {
  const { baseUrl } = await httpFixture(t, { secureCookie: false });
  const signedIn = await login(baseUrl, "developer", "123456");
  assert.equal(signedIn.response.status, 200);
  assert.doesNotMatch(signedIn.response.headers.get("set-cookie") || "", /; Secure(?:;|$)/);
});

test("production-style deployment keeps Secure cookies when enabled", async (t) => {
  const { baseUrl } = await httpFixture(t, { secureCookie: true });
  const signedIn = await login(baseUrl, "developer", "123456");
  assert.equal(signedIn.response.status, 200);
  assert.match(signedIn.response.headers.get("set-cookie") || "", /; Secure(?:;|$)/);
});

test("blank COOKIE_SECURE follows the production secure default", () => {
  assert.equal(resolveCookieSecure({ NODE_ENV: "production", COOKIE_SECURE: "" }), true);
  assert.equal(resolveCookieSecure({ NODE_ENV: "development", COOKIE_SECURE: "" }), false);
  assert.equal(resolveCookieSecure({ NODE_ENV: "production", COOKIE_SECURE: "false" }), false);
});

test("enforces role boundaries while allowing members to maintain equipment", async (t) => {
  const { service, baseUrl } = await httpFixture(t);
  const member = service.listUsers().find((user) => user.username === "member01");
  await service.changePassword(member.id, "123456", "MemberPass2026");
  const signedIn = await login(baseUrl, "member01", "MemberPass2026");
  assert.equal(signedIn.response.status, 200);

  const usersResponse = await fetch(`${baseUrl}/api/users`, { headers: { Cookie: signedIn.cookie } });
  assert.equal(usersResponse.status, 403);

  const equipmentResponse = await fetch(`${baseUrl}/api/equipment`, {
    method: "POST",
    headers: { Cookie: signedIn.cookie, "Content-Type": "application/json" },
    body: JSON.stringify({ name: "中文测试设备", code: "CIPC-HTTP-001", metric: "测试指标", lab: "量子实验室", owner: "测试成员01" })
  });
  assert.equal(equipmentResponse.status, 201);
  const equipment = (await equipmentResponse.json()).data;
  assert.equal(equipment.name, "中文测试设备");

  const statusResponse = await fetch(`${baseUrl}/api/equipment/${encodeURIComponent(equipment.id)}`, {
    method: "PATCH",
    headers: { Cookie: signedIn.cookie, "Content-Type": "application/json" },
    body: JSON.stringify({ status: "disabled" })
  });
  assert.equal(statusResponse.status, 200);
  assert.equal((await statusResponse.json()).data.status, "disabled");

  const removeResponse = await fetch(`${baseUrl}/api/equipment/${encodeURIComponent(equipment.id)}`, {
    method: "DELETE",
    headers: { Cookie: signedIn.cookie }
  });
  assert.equal(removeResponse.status, 200);
  assert.deepEqual((await removeResponse.json()).data, { id: equipment.id, removed: true });
});

test("allows only administrators and developers to force-delete equipment history", async (t) => {
  const { service, baseUrl } = await httpFixture(t);
  const member = service.listUsers().find((user) => user.username === "member01");
  const developer = service.listUsers().find((user) => user.username === "developer");
  const admin = service.createUser({ displayName: "强制删除管理员", username: "forcedeleteadmin", role: "admin" });
  await service.changePassword(member.id, "123456", "MemberForceDelete2026");
  await service.changePassword(developer.id, "123456", "DeveloperForceDelete2026");
  await service.changePassword(admin.id, "123456", "AdminForceDelete2026");
  const sessions = {
    member: await login(baseUrl, "member01", "MemberForceDelete2026"),
    developer: await login(baseUrl, "developer", "DeveloperForceDelete2026"),
    admin: await login(baseUrl, "forcedeleteadmin", "AdminForceDelete2026")
  };

  const createEquipmentWithHistory = (code) => {
    const equipment = service.createEquipment({ name: `强制删除设备 ${code}`, code, metric: "测试指标", lab: "量子实验室", owner: "测试成员01" });
    service.createReservation({ equipmentId: equipment.id, date: futureDate(23), start: "09:00", end: "10:00", people: 1, purpose: "强制删除接口测试" }, member);
    return equipment;
  };
  const memberEquipment = createEquipmentWithHistory("CIPC-HTTP-FORCE-MEMBER");
  const memberResponse = await fetch(`${baseUrl}/api/equipment/${encodeURIComponent(memberEquipment.id)}`, {
    method: "DELETE",
    headers: { Cookie: sessions.member.cookie, "Content-Type": "application/json" },
    body: JSON.stringify({ force: true })
  });
  assert.equal(memberResponse.status, 403);
  assert.equal((await memberResponse.json()).error.code, "FORBIDDEN");
  assert.equal(service.getEquipment(memberEquipment.id).id, memberEquipment.id);

  for (const role of ["admin", "developer"]) {
    const equipment = createEquipmentWithHistory(`CIPC-HTTP-FORCE-${role.toUpperCase()}`);
    const response = await fetch(`${baseUrl}/api/equipment/${encodeURIComponent(equipment.id)}`, {
      method: "DELETE",
      headers: { Cookie: sessions[role].cookie, "Content-Type": "application/json" },
      body: JSON.stringify({ force: true, expectedHistory: { reservations: 1, maintenance: 0, procurement: 0 } })
    });
    assert.equal(response.status, 200);
    assert.deepEqual((await response.json()).data, {
      id: equipment.id,
      removed: true,
      forced: true,
      deleted: { reservations: 1, maintenance: 0, procurement: 0 }
    });
  }
});

test("rejects stale force-delete history snapshots and accepts the current snapshot", async (t) => {
  const { service, baseUrl } = await httpFixture(t);
  const developer = service.listUsers().find((user) => user.username === "developer");
  const member = service.listUsers().find((user) => user.username === "member01");
  await service.changePassword(developer.id, "123456", "RaceDeleteDeveloper2026");
  const session = await login(baseUrl, "developer", "RaceDeleteDeveloper2026");
  const equipment = service.createEquipment({ name: "竞态接口设备", code: "CIPC-HTTP-FORCE-RACE", metric: "测试指标", lab: "量子实验室", owner: "测试成员01" });
  service.createReservation({ equipmentId: equipment.id, date: futureDate(24), start: "09:00", end: "10:00", people: 1, purpose: "接口竞态预约" }, member);
  const expectedHistory = { reservations: 1, maintenance: 0, procurement: 0 };
  service.createMaintenanceRecord({ equipmentId: equipment.id, type: "repair", status: "open", date: "2026-07-27", description: "接口新增维修" }, member);

  const stale = await fetch(`${baseUrl}/api/equipment/${encodeURIComponent(equipment.id)}`, {
    method: "DELETE",
    headers: { Cookie: session.cookie, "Content-Type": "application/json" },
    body: JSON.stringify({ force: true, expectedHistory })
  });
  assert.equal(stale.status, 409);
  const staleError = (await stale.json()).error;
  assert.equal(staleError.code, "EQUIPMENT_HISTORY_CHANGED");
  assert.deepEqual(staleError.details, { reservations: 1, maintenance: 1, procurement: 0 });
  assert.equal(service.getEquipment(equipment.id).id, equipment.id);

  const current = await fetch(`${baseUrl}/api/equipment/${encodeURIComponent(equipment.id)}`, {
    method: "DELETE",
    headers: { Cookie: session.cookie, "Content-Type": "application/json" },
    body: JSON.stringify({ force: true, expectedHistory: staleError.details })
  });
  assert.equal(current.status, 200);
  assert.deepEqual((await current.json()).data.deleted, { reservations: 1, maintenance: 1, procurement: 0 });
});

test("edits equipment details through PATCH and validates editable fields", async (t) => {
  const { service, baseUrl } = await httpFixture(t);
  const member = service.listUsers().find((user) => user.username === "member01");
  const developer = service.listUsers().find((user) => user.username === "developer");
  const admin = service.createUser({ displayName: "设备管理员", username: "equipmentadmin", role: "admin" });
  await service.changePassword(member.id, "123456", "EquipmentEdit2026");
  await service.changePassword(developer.id, "123456", "DeveloperEdit2026");
  await service.changePassword(admin.id, "123456", "AdminEdit2026");
  const signedIn = await login(baseUrl, "member01", "EquipmentEdit2026");
  const [laboratory] = service.listLaboratories();
  const equipment = service.createEquipment({ name: "待编辑设备", code: "CIPC-HTTP-EDIT-001", metric: "旧指标", lab: "量子实验室", owner: "测试成员01" });
  service.createEquipment({ name: "重复编号设备", code: "CIPC-HTTP-EDIT-002", metric: "指标", lab: "量子实验室", owner: "测试成员01" });

  const success = await fetch(`${baseUrl}/api/equipment/${encodeURIComponent(equipment.id)}`, {
    method: "PATCH",
    headers: { Cookie: signedIn.cookie, "Content-Type": "application/json" },
    body: JSON.stringify({ name: "已编辑设备", code: "cipc-http-edit-updated", metric: "新指标", laboratoryId: laboratory.id, owner: "新保管人" })
  });
  assert.equal(success.status, 200);
  const updated = (await success.json()).data;
  assert.equal(updated.code, "CIPC-HTTP-EDIT-UPDATED");
  assert.equal(updated.lab, laboratory.name);
  assert.equal(updated.location, laboratory.name);

  for (const [username, password, owner] of [
    ["equipmentadmin", "AdminEdit2026", "管理员可编辑"],
    ["developer", "DeveloperEdit2026", "开发者可编辑"]
  ]) {
    const roleSession = await login(baseUrl, username, password);
    const roleEdit = await fetch(`${baseUrl}/api/equipment/${encodeURIComponent(equipment.id)}`, {
      method: "PATCH",
      headers: { Cookie: roleSession.cookie, "Content-Type": "application/json" },
      body: JSON.stringify({ owner })
    });
    assert.equal(roleEdit.status, 200);
    assert.equal((await roleEdit.json()).data.owner, owner);
  }

  const duplicate = await fetch(`${baseUrl}/api/equipment/${encodeURIComponent(equipment.id)}`, {
    method: "PATCH",
    headers: { Cookie: signedIn.cookie, "Content-Type": "application/json" },
    body: JSON.stringify({ code: "cipc-http-edit-002" })
  });
  assert.equal(duplicate.status, 409);
  assert.equal((await duplicate.json()).error.code, "EQUIPMENT_CODE_EXISTS");

  const invalidLaboratory = await fetch(`${baseUrl}/api/equipment/${encodeURIComponent(equipment.id)}`, {
    method: "PATCH",
    headers: { Cookie: signedIn.cookie, "Content-Type": "application/json" },
    body: JSON.stringify({ laboratoryId: "missing" })
  });
  assert.equal(invalidLaboratory.status, 400);
  assert.equal((await invalidLaboratory.json()).error.code, "LABORATORY_NOT_FOUND");

  const noEditableFields = await fetch(`${baseUrl}/api/equipment/${encodeURIComponent(equipment.id)}`, {
    method: "PATCH",
    headers: { Cookie: signedIn.cookie, "Content-Type": "application/json" },
    body: JSON.stringify({ ignored: true })
  });
  assert.equal(noEditableFields.status, 400);
  assert.equal((await noEditableFields.json()).error.code, "VALIDATION_ERROR");
});

test("creates reservations without approval and lets the requester cancel", async (t) => {
  const { service, baseUrl } = await httpFixture(t);
  const member = service.listUsers().find((user) => user.username === "member01");
  await service.changePassword(member.id, "123456", "MemberPass2026");
  const signedIn = await login(baseUrl, "member01", "MemberPass2026");
  const equipment = service.createEquipment({ name: "预约设备", code: "CIPC-HTTP-002", metric: "测试指标", lab: "量子实验室", owner: "测试成员01" });

  const reservationResponse = await fetch(`${baseUrl}/api/reservations`, {
    method: "POST",
    headers: { Cookie: signedIn.cookie, "Content-Type": "application/json" },
    body: JSON.stringify({ equipmentId: equipment.id, date: futureDate(5), start: "09:00", end: "10:00", people: 1, purpose: "接口测试" })
  });
  assert.equal(reservationResponse.status, 201);
  const reservation = (await reservationResponse.json()).data;
  assert.equal(reservation.status, "approved");
  assert.equal(reservation.requesterUserId, member.id);

  const cancelResponse = await fetch(`${baseUrl}/api/reservations/${encodeURIComponent(reservation.id)}/cancel`, {
    method: "PATCH",
    headers: { Cookie: signedIn.cookie, "Content-Type": "application/json" },
    body: "{}"
  });
  assert.equal(cancelResponse.status, 200);
  assert.equal((await cancelResponse.json()).data.status, "cancelled");

  const protectedRemove = await fetch(`${baseUrl}/api/equipment/${encodeURIComponent(equipment.id)}`, {
    method: "DELETE",
    headers: { Cookie: signedIn.cookie }
  });
  assert.equal(protectedRemove.status, 409);
  assert.equal((await protectedRemove.json()).error.code, "EQUIPMENT_HAS_HISTORY");
});

test("rejects past start times and exposes the effective reservation status", async (t) => {
  const { database, service, baseUrl } = await httpFixture(t);
  const member = service.listUsers().find((user) => user.username === "member01");
  await service.changePassword(member.id, "123456", "LifecyclePass2026");
  const signedIn = await login(baseUrl, "member01", "LifecyclePass2026");
  const equipment = service.createEquipment({ name: "生命周期设备", code: "CIPC-HTTP-LIFECYCLE", metric: "测试指标", lab: "量子实验室", owner: "测试成员01" });

  const expiredResponse = await fetch(`${baseUrl}/api/reservations`, {
    method: "POST",
    headers: { Cookie: signedIn.cookie, "Content-Type": "application/json" },
    body: JSON.stringify({ equipmentId: equipment.id, date: todayInShanghai(), start: "00:00", end: "23:59", people: 1, purpose: "过期预约" })
  });
  assert.equal(expiredResponse.status, 400);
  assert.equal((await expiredResponse.json()).error.code, "PAST_RESERVATION_TIME");

  const reservation = service.createReservation({
    equipmentId: equipment.id,
    date: futureDate(5),
    start: "10:00",
    end: "11:00",
    people: 1,
    purpose: "状态接口验证"
  }, member);
  const now = Date.now();
  database.prepare("UPDATE reservations SET start_at = ?, end_at = ? WHERE id = ?")
    .run(new Date(now - 60_000).toISOString(), new Date(now + 60_000).toISOString(), reservation.id);

  const listResponse = await fetch(`${baseUrl}/api/reservations`, { headers: { Cookie: signedIn.cookie } });
  assert.equal(listResponse.status, 200);
  assert.equal((await listResponse.json()).data.find((item) => item.id === reservation.id).status, "in_use");

  const cancelResponse = await fetch(`${baseUrl}/api/reservations/${encodeURIComponent(reservation.id)}/cancel`, {
    method: "PATCH",
    headers: { Cookie: signedIn.cookie, "Content-Type": "application/json" },
    body: "{}"
  });
  assert.equal(cancelResponse.status, 409);
  assert.equal((await cancelResponse.json()).error.code, "RESERVATION_ALREADY_STARTED");
});

test("advertises DELETE for authenticated equipment maintenance", async (t) => {
  const origin = "https://equip.example.test";
  const { baseUrl } = await httpFixture(t, { allowedOrigins: new Set([origin]) });
  const response = await fetch(`${baseUrl}/api/equipment/example`, {
    method: "OPTIONS",
    headers: { Origin: origin, "Access-Control-Request-Method": "DELETE" }
  });
  assert.equal(response.status, 204);
  assert.match(response.headers.get("access-control-allow-methods") || "", /DELETE/);
});

test("allows every business role to use meeting rooms and only the requester can cancel", async (t) => {
  const { service, baseUrl } = await httpFixture(t);
  const member = service.listUsers().find((user) => user.username === "member01");
  const developer = service.listUsers().find((user) => user.username === "developer");
  const admin = service.createUser({ displayName: "会议管理员", username: "roomadmin", role: "admin" });
  await service.changePassword(member.id, "123456", "MemberPass2026");
  await service.changePassword(developer.id, "123456", "DeveloperPass2026");
  await service.changePassword(admin.id, "123456", "AdminPass2026");
  const memberLogin = await login(baseUrl, "member01", "MemberPass2026");
  const roomsResponse = await fetch(`${baseUrl}/api/meeting-rooms`, { headers: { Cookie: memberLogin.cookie } });
  assert.equal(roomsResponse.status, 200);
  const room = (await roomsResponse.json()).data.find((item) => item.name === "3楼会议室");
  assert.ok(room);

  const reservationResponse = await fetch(`${baseUrl}/api/room-reservations`, {
    method: "POST",
    headers: { Cookie: memberLogin.cookie, "Content-Type": "application/json" },
    body: JSON.stringify({ meetingRoomId: room.id, date: futureDate(14), start: "13:00", end: "14:00", people: 5, purpose: "接口会议" })
  });
  assert.equal(reservationResponse.status, 201);
  const reservation = (await reservationResponse.json()).data;
  assert.equal(reservation.status, "approved");
  assert.equal(reservation.requesterUserId, member.id);

  const adminLogin = await login(baseUrl, "roomadmin", "AdminPass2026");
  const forbiddenCancel = await fetch(`${baseUrl}/api/room-reservations/${encodeURIComponent(reservation.id)}/cancel`, {
    method: "PATCH", headers: { Cookie: adminLogin.cookie, "Content-Type": "application/json" }, body: "{}"
  });
  assert.equal(forbiddenCancel.status, 403);

  for (const [username, password] of [["member01", "MemberPass2026"], ["roomadmin", "AdminPass2026"], ["developer", "DeveloperPass2026"]]) {
    const signedIn = await login(baseUrl, username, password);
    const list = await fetch(`${baseUrl}/api/room-reservations?meetingRoomId=${encodeURIComponent(room.id)}`, { headers: { Cookie: signedIn.cookie } });
    assert.equal(list.status, 200);
    assert.equal((await list.json()).data.length, 1);
  }
  const developerLogin = await login(baseUrl, "developer", "DeveloperPass2026");
  const developerCancel = await fetch(`${baseUrl}/api/room-reservations/${encodeURIComponent(reservation.id)}/cancel`, {
    method: "PATCH", headers: { Cookie: developerLogin.cookie, "Content-Type": "application/json" }, body: "{}"
  });
  assert.equal(developerCancel.status, 200);
  assert.equal((await developerCancel.json()).data.status, "cancelled");
});

test("restricts meeting-room management and exposes paginated audit filters", async (t) => {
  const { service, baseUrl } = await httpFixture(t);
  const member = service.listUsers().find((user) => user.username === "member01");
  const developer = service.listUsers().find((user) => user.username === "developer");
  await service.changePassword(member.id, "123456", "RoomMember2026");
  await service.changePassword(developer.id, "123456", "RoomDeveloper2026");
  const memberSession = await login(baseUrl, "member01", "RoomMember2026");
  const developerSession = await login(baseUrl, "developer", "RoomDeveloper2026");

  const forbidden = await fetch(`${baseUrl}/api/meeting-rooms`, {
    method: "POST", headers: { Cookie: memberSession.cookie, "Content-Type": "application/json" },
    body: JSON.stringify({ name: "成员会议室", code: "MEMBER-ROOM", capacity: 4 })
  });
  assert.equal(forbidden.status, 403);

  const createdResponse = await fetch(`${baseUrl}/api/meeting-rooms`, {
    method: "POST", headers: { Cookie: developerSession.cookie, "Content-Type": "application/json" },
    body: JSON.stringify({ name: "接口研讨室", code: "HTTP-ROOM", capacity: 6, location: "5楼" })
  });
  assert.equal(createdResponse.status, 201);
  const room = (await createdResponse.json()).data;
  const updatedResponse = await fetch(`${baseUrl}/api/meeting-rooms/${encodeURIComponent(room.id)}`, {
    method: "PATCH", headers: { Cookie: developerSession.cookie, "Content-Type": "application/json" },
    body: JSON.stringify({ capacity: 12 })
  });
  assert.equal(updatedResponse.status, 200);
  assert.equal((await updatedResponse.json()).data.capacity, 12);

  const pagedAudit = await fetch(`${baseUrl}/api/audit-logs?page=1&pageSize=1&entityType=meeting_room`, { headers: { Cookie: developerSession.cookie } });
  assert.equal(pagedAudit.status, 200);
  const auditData = (await pagedAudit.json()).data;
  assert.equal(auditData.items.length, 1);
  assert.equal(auditData.pagination.total, 2);
  assert.equal(auditData.pagination.totalPages, 2);

  const health = await fetch(`${baseUrl}/api/health`);
  assert.equal(health.status, 200);
  const healthData = await health.json();
  assert.equal(healthData.status, "ok");
  assert.equal(healthData.database, undefined);
  assert.equal(healthData.schemaVersion, undefined);
  assert.equal(healthData.counts, undefined);

  const forbiddenExport = await fetch(`${baseUrl}/api/audit-logs.csv`, { headers: { Cookie: memberSession.cookie } });
  assert.equal(forbiddenExport.status, 403);
  const formulaAdmin = service.createUser({ displayName: "=2+2", username: "formulaadmin", role: "admin" });
  await service.changePassword(formulaAdmin.id, "123456", "FormulaAdmin2026");
  const formulaAdminSession = await login(baseUrl, "formulaadmin", "FormulaAdmin2026");
  const formulaRoom = await fetch(`${baseUrl}/api/meeting-rooms`, {
    method: "POST", headers: { Cookie: formulaAdminSession.cookie, "Content-Type": "application/json" },
    body: JSON.stringify({ name: "公式导出测试室", code: "CSV-FORMULA-ROOM", capacity: 4 })
  });
  assert.equal(formulaRoom.status, 201);
  const csvResponse = await fetch(`${baseUrl}/api/audit-logs.csv?entityType=meeting_room`, { headers: { Cookie: formulaAdminSession.cookie } });
  assert.equal(csvResponse.status, 200);
  assert.match(csvResponse.headers.get("content-type") || "", /text\/csv/);
  assert.match(await csvResponse.text(), /"'=2\+2"/);
});

test("restricts laboratory management to administrators and supports inactive listings", async (t) => {
  const { service, baseUrl } = await httpFixture(t);
  const member = service.listUsers().find((user) => user.username === "member01");
  const developer = service.listUsers().find((user) => user.username === "developer");
  await service.changePassword(member.id, "123456", "LaboratoryMember2026");
  await service.changePassword(developer.id, "123456", "LaboratoryDeveloper2026");
  const memberSession = await login(baseUrl, "member01", "LaboratoryMember2026");
  const developerSession = await login(baseUrl, "developer", "LaboratoryDeveloper2026");

  const forbidden = await fetch(`${baseUrl}/api/laboratories`, {
    method: "POST", headers: { Cookie: memberSession.cookie, "Content-Type": "application/json" },
    body: JSON.stringify({ code: "HTTP-LAB-09", name: "成员新实验室", alias: "成员空间" })
  });
  assert.equal(forbidden.status, 403);

  const createdResponse = await fetch(`${baseUrl}/api/laboratories`, {
    method: "POST", headers: { Cookie: developerSession.cookie, "Content-Type": "application/json" },
    body: JSON.stringify({ code: "HTTP-LAB-09", name: "接口新实验室", alias: "接口空间", sortOrder: 90 })
  });
  assert.equal(createdResponse.status, 201);
  const laboratory = (await createdResponse.json()).data;
  assert.equal(laboratory.code, "HTTP-LAB-09");

  const memberList = await fetch(`${baseUrl}/api/laboratories`, { headers: { Cookie: memberSession.cookie } });
  assert.equal(memberList.status, 200);
  assert.equal((await memberList.json()).data.some((item) => item.id === laboratory.id), true);

  const updatedResponse = await fetch(`${baseUrl}/api/laboratories/${encodeURIComponent(laboratory.id)}`, {
    method: "PATCH", headers: { Cookie: developerSession.cookie, "Content-Type": "application/json" },
    body: JSON.stringify({ active: false, name: "接口停用实验室" })
  });
  assert.equal(updatedResponse.status, 200);
  assert.equal((await updatedResponse.json()).data.active, false);

  const memberAfterUpdate = await fetch(`${baseUrl}/api/laboratories`, { headers: { Cookie: memberSession.cookie } });
  assert.equal((await memberAfterUpdate.json()).data.some((item) => item.id === laboratory.id), false);
  const managerList = await fetch(`${baseUrl}/api/laboratories?includeInactive=true`, { headers: { Cookie: developerSession.cookie } });
  assert.equal(managerList.status, 200);
  assert.equal((await managerList.json()).data.find((item) => item.id === laboratory.id).active, false);
  const memberManagerList = await fetch(`${baseUrl}/api/laboratories?includeInactive=true`, { headers: { Cookie: memberSession.cookie } });
  assert.equal(memberManagerList.status, 403);
});

test("exposes the developer-only update center and queues a verified release", async (t) => {
  const manager = {
    repository: "example/project",
    getStatus: () => ({ state: "idle", currentVersion: "1.3.1", message: "暂无升级任务" }),
    check: async () => ({ currentVersion: "1.3.1", latestVersion: "1.4.0", updateAvailable: true, repository: "example/project", releaseNotes: "测试更新" }),
    requestUpgrade: async (version, actor) => ({ state: "queued", targetVersion: version, actor: actor.username, requestId: "request-1" })
  };
  const { service, baseUrl } = await httpFixture(t, { updateManager: manager });
  const developer = service.listUsers().find((user) => user.username === "developer");
  const member = service.listUsers().find((user) => user.username === "member01");
  await service.changePassword(developer.id, "123456", "UpdateDeveloper2026");
  await service.changePassword(member.id, "123456", "UpdateMember2026");
  const developerSession = await login(baseUrl, "developer", "UpdateDeveloper2026");
  const memberSession = await login(baseUrl, "member01", "UpdateMember2026");
  assert.equal((await (await fetch(`${baseUrl}/api/update/check`, { headers: { Cookie: memberSession.cookie } })).json()).error.code, "FORBIDDEN");
  const check = await fetch(`${baseUrl}/api/update/check`, { headers: { Cookie: developerSession.cookie } });
  assert.equal(check.status, 200);
  assert.equal((await check.json()).data.latestVersion, "1.4.0");
  const queued = await fetch(`${baseUrl}/api/update`, { method: "POST", headers: { Cookie: developerSession.cookie, "Content-Type": "application/json" }, body: JSON.stringify({ version: "1.4.0" }) });
  assert.equal(queued.status, 202);
  assert.equal((await queued.json()).data.state, "queued");
});

test("lets every business role access maintenance and procurement records", async (t) => {
  const { service, baseUrl } = await httpFixture(t);
  const member = service.listUsers().find((user) => user.username === "member01");
  const developer = service.listUsers().find((user) => user.username === "developer");
  const admin = service.createUser({ displayName: "业务管理员", username: "recordsadmin", role: "admin" });
  const equipment = service.createEquipment({ name: "业务记录设备", code: "CIPC-HTTP-003", metric: "测试指标", lab: "量子实验室", owner: "测试成员01" });
  await service.changePassword(member.id, "123456", "MemberPass2026");
  await service.changePassword(developer.id, "123456", "DeveloperPass2026");
  await service.changePassword(admin.id, "123456", "AdminPass2026");
  const memberLogin = await login(baseUrl, "member01", "MemberPass2026");

  const maintenanceResponse = await fetch(`${baseUrl}/api/maintenance-records`, {
    method: "POST",
    headers: { Cookie: memberLogin.cookie, "Content-Type": "application/json" },
    body: JSON.stringify({ equipmentId: equipment.id, type: "repair", status: "in_progress", date: "2026-07-27", description: "更换损耗件", cost: 88 })
  });
  assert.equal(maintenanceResponse.status, 201);
  const maintenance = (await maintenanceResponse.json()).data;
  assert.equal(maintenance.createdByUserId, member.id);
  assert.equal(maintenance.equipmentStatus, "maintenance");

  const equipmentUnderMaintenance = await fetch(`${baseUrl}/api/equipment`, { headers: { Cookie: memberLogin.cookie } });
  assert.equal((await equipmentUnderMaintenance.json()).data.find((item) => item.id === equipment.id).status, "maintenance");

  const completedMaintenance = await fetch(`${baseUrl}/api/maintenance-records/${encodeURIComponent(maintenance.id)}`, {
    method: "PATCH",
    headers: { Cookie: memberLogin.cookie, "Content-Type": "application/json" },
    body: JSON.stringify({ status: "completed" })
  });
  assert.equal(completedMaintenance.status, 200);
  assert.equal((await completedMaintenance.json()).data.equipmentStatus, "available");

  const procurementResponse = await fetch(`${baseUrl}/api/procurement-records`, {
    method: "POST",
    headers: { Cookie: memberLogin.cookie, "Content-Type": "application/json" },
    body: JSON.stringify({ equipmentId: equipment.id, vendor: "供应商 A", date: "2026-07-27", amount: 1800, status: "accepted", notes: "接口测试" })
  });
  assert.equal(procurementResponse.status, 201);
  const procurement = (await procurementResponse.json()).data;
  assert.equal(procurement.amount, 1800);

  const updatedProcurement = await fetch(`${baseUrl}/api/procurement-records/${encodeURIComponent(procurement.id)}`, {
    method: "PATCH",
    headers: { Cookie: memberLogin.cookie, "Content-Type": "application/json" },
    body: JSON.stringify({ status: "rejected" })
  });
  assert.equal(updatedProcurement.status, 200);
  assert.equal((await updatedProcurement.json()).data.status, "rejected");

  for (const [username, password] of [["member01", "MemberPass2026"], ["recordsadmin", "AdminPass2026"], ["developer", "DeveloperPass2026"]]) {
    const signedIn = await login(baseUrl, username, password);
    assert.equal(signedIn.response.status, 200);
    const maintenanceList = await fetch(`${baseUrl}/api/maintenance-records?equipmentId=${encodeURIComponent(equipment.id)}`, { headers: { Cookie: signedIn.cookie } });
    const procurementList = await fetch(`${baseUrl}/api/procurement-records?equipmentId=${encodeURIComponent(equipment.id)}`, { headers: { Cookie: signedIn.cookie } });
    assert.equal(maintenanceList.status, 200);
    assert.equal(procurementList.status, 200);
    assert.equal((await maintenanceList.json()).data.length, 1);
    assert.equal((await procurementList.json()).data.length, 1);
  }
});

test("reissues the session cookie after a password change", async (t) => {
  const { baseUrl } = await httpFixture(t);
  const signedIn = await login(baseUrl, "developer", "123456");
  const changed = await fetch(`${baseUrl}/api/auth/change-password`, {
    method: "POST",
    headers: { Cookie: signedIn.cookie, "Content-Type": "application/json" },
    body: JSON.stringify({ currentPassword: "123456", newPassword: "DeveloperPass2026" })
  });
  assert.equal(changed.status, 200);
  const nextCookie = changed.headers.get("set-cookie")?.split(";", 1)[0] || "";
  assert.notEqual(nextCookie, signedIn.cookie);

  const oldSession = await fetch(`${baseUrl}/api/auth/session`, { headers: { Cookie: signedIn.cookie } });
  const newSession = await fetch(`${baseUrl}/api/auth/session`, { headers: { Cookie: nextCookie } });
  assert.equal(oldSession.status, 401);
  assert.equal(newSession.status, 200);
});

test("rate limits repeated current-password failures independently", async (t) => {
  const { baseUrl } = await httpFixture(t);
  const signedIn = await login(baseUrl, "developer", "123456");
  assert.equal(signedIn.response.status, 200);

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const response = await fetch(`${baseUrl}/api/auth/change-password`, {
      method: "POST",
      headers: { Cookie: signedIn.cookie, "Content-Type": "application/json" },
      body: JSON.stringify({ currentPassword: "wrong-password", newPassword: "DeveloperPass2026" })
    });
    assert.equal(response.status, 400);
    assert.equal((await response.json()).error.code, "CURRENT_PASSWORD_INVALID");
  }

  const limited = await fetch(`${baseUrl}/api/auth/change-password`, {
    method: "POST",
    headers: { Cookie: signedIn.cookie, "Content-Type": "application/json" },
    body: JSON.stringify({ currentPassword: "123456", newPassword: "DeveloperPass2026" })
  });
  assert.equal(limited.status, 429);
  assert.equal((await limited.json()).error.code, "PASSWORD_CHANGE_RATE_LIMITED");
});

test("rate limits repeated login failures", async (t) => {
  const { baseUrl } = await httpFixture(t);
  for (let attempt = 0; attempt < 5; attempt += 1) {
    assert.equal((await login(baseUrl, "developer", "wrong-password")).response.status, 401);
  }
  const blocked = await login(baseUrl, "developer", "wrong-password");
  assert.equal(blocked.response.status, 429);
  assert.equal(blocked.payload.error.code, "LOGIN_RATE_LIMITED");
});

test("bounds limiter keys and rate limits rotating usernames from one trusted source", async (t) => {
  const serverModule = await import("../server.mjs");
  assert.equal(typeof serverModule.createFailureLimiter, "function");

  const boundedLimiter = serverModule.createFailureLimiter({ maxFailures: 1, maxKeys: 2 });
  boundedLimiter.recordFailure("first");
  boundedLimiter.recordFailure("second");
  boundedLimiter.recordFailure("third");
  assert.doesNotThrow(() => boundedLimiter.assertAllowed("first"));
  assert.throws(
    () => boundedLimiter.assertAllowed("second"),
    (error) => error instanceof AppError && error.code === "LOGIN_RATE_LIMITED"
  );

  const loginSourceLimiter = serverModule.createFailureLimiter({ maxFailures: 3, maxKeys: 10 });
  const { baseUrl } = await httpFixture(t, { loginSourceLimiter, trustProxy: true });
  const sourceHeader = { "CF-Connecting-IP": "203.0.113.10" };
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const failed = await login(baseUrl, `unknown-${attempt}`, "wrong-password", sourceHeader);
    assert.equal(failed.response.status, 401);
  }
  const blocked = await login(baseUrl, "another-unknown", "wrong-password", sourceHeader);
  assert.equal(blocked.response.status, 429);
  assert.equal(blocked.payload.error.code, "LOGIN_RATE_LIMITED");

  const directSourceLimiter = serverModule.createFailureLimiter({ maxFailures: 1, maxKeys: 10 });
  const direct = await httpFixture(t, { loginSourceLimiter: directSourceLimiter, trustProxy: false });
  assert.equal((await login(direct.baseUrl, "direct-one", "wrong-password", { "CF-Connecting-IP": "203.0.113.11" })).response.status, 401);
  assert.equal((await login(direct.baseUrl, "direct-two", "wrong-password", { "CF-Connecting-IP": "203.0.113.12" })).response.status, 429);
});

test("exposes scoped audit logs and merged personal reservations", async (t) => {
  const { service, baseUrl } = await httpFixture(t);
  const member = service.listUsers().find((user) => user.username === "member01");
  const developer = service.listUsers().find((user) => user.username === "developer");
  await service.changePassword(member.id, "123456", "AuditHttpMember2026");
  await service.changePassword(developer.id, "123456", "AuditHttpDeveloper2026");
  const memberSession = await login(baseUrl, "member01", "AuditHttpMember2026");
  const developerSession = await login(baseUrl, "developer", "AuditHttpDeveloper2026");
  const equipment = service.createEquipment({ name: "我的预约接口设备", code: "CIPC-HTTP-MY-RESERVATION", metric: "测试", lab: "量子实验室", owner: "测试成员01" }, developer);
  const room = service.listMeetingRooms()[0];

  const equipmentResponse = await fetch(`${baseUrl}/api/reservations`, {
    method: "POST", headers: { Cookie: memberSession.cookie, "Content-Type": "application/json" },
    body: JSON.stringify({ equipmentId: equipment.id, date: futureDate(30), start: "09:00", end: "10:00", people: 1, purpose: "个人设备接口预约" })
  });
  assert.equal(equipmentResponse.status, 201);
  const roomResponse = await fetch(`${baseUrl}/api/room-reservations`, {
    method: "POST", headers: { Cookie: memberSession.cookie, "Content-Type": "application/json" },
    body: JSON.stringify({ meetingRoomId: room.id, date: futureDate(31), start: "10:00", end: "11:00", people: 2, purpose: "个人会议接口预约" })
  });
  assert.equal(roomResponse.status, 201);

  const anonymousAudit = await fetch(`${baseUrl}/api/audit-logs`);
  assert.equal(anonymousAudit.status, 401);
  const memberAudit = await fetch(`${baseUrl}/api/audit-logs`, { headers: { Cookie: memberSession.cookie } });
  assert.equal(memberAudit.status, 200);
  assert.ok((await memberAudit.json()).data.every((item) => item.actorUserId === member.id));
  const developerAudit = await fetch(`${baseUrl}/api/audit-logs`, { headers: { Cookie: developerSession.cookie } });
  assert.equal(developerAudit.status, 200);
  assert.ok((await developerAudit.json()).data.length >= 3);

  const mine = await fetch(`${baseUrl}/api/my-reservations?status=approved`, { headers: { Cookie: memberSession.cookie } });
  assert.equal(mine.status, 200);
  const rows = (await mine.json()).data;
  assert.deepEqual(new Set(rows.map((item) => item.resourceType)), new Set(["equipment", "meeting_room"]));
  assert.ok(rows.every((item) => item.requesterUserId === member.id && item.status === "approved"));
});
