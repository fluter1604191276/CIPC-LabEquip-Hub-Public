import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDatabase } from "../lib/database.mjs";
import { AppError, createService } from "../lib/service.mjs";

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

function fixture() {
  const database = createDatabase(":memory:", { seed: false });
  const service = createService(database);
  const equipment = service.createEquipment({
    name: "测试光谱仪",
    code: "CIPC-TEST-001",
    metric: "400-800 nm",
    lab: "测试实验室",
    owner: "测试老师",
    status: "available"
  });
  return { database, service, equipment };
}

function createLaboratory(database, { id = "test-laboratory-id", name = "测试实验室" } = {}) {
  const now = new Date().toISOString();
  database.prepare(`
    INSERT INTO laboratories (id, code, name, alias, sort_order, is_active, created_at, updated_at)
    VALUES (?, ?, ?, ?, 1, 1, ?, ?)
  `).run(id, `LAB-${id}`, name, "测试空间", now, now);
  return { id, name };
}

test("creates and lists equipment", () => {
  const { database, service, equipment } = fixture();
  const literal = service.createEquipment({ name: "校准%_\\标准", code: "CIPC-LIKE-001", metric: "通配符测试", lab: "测试实验室", owner: "测试老师" });
  assert.equal(service.listEquipment().length, 2);
  assert.equal(equipment.label, "可用");
  assert.equal(equipment.location, "测试实验室");
  assert.equal(service.listEquipment({ query: "光谱" })[0].code, "CIPC-TEST-001");
  for (const query of ["%", "_", "\\"]) {
    assert.deepEqual(service.listEquipment({ query }).map((item) => item.id), [literal.id]);
  }
  database.close();
});

test("rejects duplicate equipment codes case-insensitively", () => {
  const { database, service } = fixture();
  assert.throws(
    () => service.createEquipment({ name: "重复设备", code: "cipc-test-001", metric: "x", lab: "测试实验室", location: "T-102", owner: "测试老师" }),
    (error) => error instanceof AppError && error.status === 409 && error.code === "EQUIPMENT_CODE_EXISTS"
  );
  database.close();
});

test("updates equipment status and validates the requested state", () => {
  const { database, service, equipment } = fixture();
  assert.equal(service.updateEquipmentStatus(equipment.id, { status: "disabled" }).status, "disabled");
  assert.equal(service.updateEquipmentStatus(equipment.id, { status: "retired" }).label, "已报废");
  assert.throws(
    () => service.updateEquipmentStatus(equipment.id, { status: "reserved" }),
    (error) => error instanceof AppError && error.status === 400 && error.code === "VALIDATION_ERROR"
  );
  assert.throws(
    () => service.updateEquipmentStatus(equipment.id, { status: "unknown" }),
    (error) => error instanceof AppError && error.status === 400 && error.code === "VALIDATION_ERROR"
  );
  assert.throws(
    () => service.updateEquipmentStatus("missing", { status: "available" }),
    (error) => error instanceof AppError && error.status === 404 && error.code === "EQUIPMENT_NOT_FOUND"
  );
  database.close();
});

test("edits equipment business fields and keeps status-only updates compatible", () => {
  const { database, service, equipment } = fixture();
  const laboratory = createLaboratory(database, { id: "equipment-edit-lab", name: "编辑实验室" });
  const updated = service.updateEquipment(equipment.id, {
    name: "更新后的光谱仪",
    code: "cipc-test-updated",
    metric: "450-900 nm",
    laboratoryId: laboratory.id,
    owner: "更新保管人"
  });
  assert.equal(updated.name, "更新后的光谱仪");
  assert.equal(updated.code, "CIPC-TEST-UPDATED");
  assert.equal(updated.metric, "450-900 nm");
  assert.equal(updated.lab, laboratory.name);
  assert.equal(updated.location, laboratory.name);
  assert.equal(updated.owner, "更新保管人");
  assert.equal(updated.status, "available");
  assert.equal(service.updateEquipment(equipment.id, { status: "disabled" }).status, "disabled");
  database.close();
});

test("validates equipment edits and excludes the current equipment from code uniqueness", () => {
  const { database, service, equipment } = fixture();
  const other = service.createEquipment({ name: "其他设备", code: "CIPC-TEST-OTHER", metric: "x", lab: "测试实验室", owner: "测试老师" });
  assert.equal(service.updateEquipment(equipment.id, { code: "cipc-test-001" }).code, "CIPC-TEST-001");
  assert.throws(
    () => service.updateEquipment(equipment.id, { code: other.code.toLowerCase() }),
    (error) => error instanceof AppError && error.status === 409 && error.code === "EQUIPMENT_CODE_EXISTS"
  );
  assert.throws(
    () => service.updateEquipment(equipment.id, { laboratoryId: "missing" }),
    (error) => error instanceof AppError && error.status === 400 && error.code === "LABORATORY_NOT_FOUND"
  );
  assert.throws(
    () => service.updateEquipment(equipment.id, { unrecognized: true }),
    (error) => error instanceof AppError && error.status === 400 && error.code === "VALIDATION_ERROR"
  );
  database.close();
});

test("normalizes legacy reserved equipment when reopening the database", () => {
  const directory = mkdtempSync(join(tmpdir(), "cipc-reserved-status-"));
  const filePath = join(directory, "app.sqlite");
  try {
    const database = createDatabase(filePath, { seed: false });
    const service = createService(database);
    const item = service.createEquipment({
      name: "旧状态设备",
      code: "CIPC-LEGACY-RESERVED",
      metric: "legacy",
      lab: "测试实验室",
      owner: "测试老师"
    });
    database.prepare("UPDATE equipment SET status = 'reserved' WHERE id = ?").run(item.id);
    database.close();

    const reopened = createDatabase(filePath, { seed: false });
    assert.equal(createService(reopened).getEquipment(item.id).status, "available");
    reopened.close();
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("removes equipment without history and protects every kind of business history", () => {
  const { database, service, equipment } = fixture();
  assert.deepEqual(service.removeEquipment(equipment.id), { id: equipment.id, removed: true });
  assert.equal(service.listEquipment().length, 0);
  assert.throws(
    () => service.removeEquipment(equipment.id),
    (error) => error instanceof AppError && error.status === 404 && error.code === "EQUIPMENT_NOT_FOUND"
  );

  const actor = service.createUser({ displayName: "档案成员", username: "historymember", role: "member" });
  const withReservation = service.createEquipment({ name: "预约历史设备", code: "CIPC-HISTORY-001", metric: "x", lab: "测试实验室", owner: "测试老师" });
  service.createReservation({ equipmentId: withReservation.id, date: futureDate(20), start: "09:00", end: "10:00", people: 1, purpose: "历史预约" }, actor);
  const withMaintenance = service.createEquipment({ name: "维修历史设备", code: "CIPC-HISTORY-002", metric: "x", lab: "测试实验室", owner: "测试老师" });
  service.createMaintenanceRecord({ equipmentId: withMaintenance.id, type: "repair", status: "open", date: "2026-07-27", description: "历史维修" }, actor);
  const withProcurement = service.createEquipment({ name: "采购历史设备", code: "CIPC-HISTORY-003", metric: "x", lab: "测试实验室", owner: "测试老师" });
  service.createProcurementRecord({ equipmentId: withProcurement.id, vendor: "测试供应商", date: "2026-07-27", amount: 100, status: "accepted" }, actor);

  for (const item of [withReservation, withMaintenance, withProcurement]) {
    assert.throws(
      () => service.removeEquipment(item.id),
      (error) => error instanceof AppError && error.status === 409 && error.code === "EQUIPMENT_HAS_HISTORY"
    );
  }
  assert.equal(service.listEquipment().length, 3);
  database.close();
});

test("force-removes equipment history atomically and reports deleted record counts", () => {
  const { database, service, equipment } = fixture();
  const actor = service.createUser({ displayName: "强制删除成员", username: "forcedeletemember", role: "member" });
  service.createReservation({ equipmentId: equipment.id, date: futureDate(21), start: "09:00", end: "10:00", people: 1, purpose: "强制删除预约" }, actor);
  service.createMaintenanceRecord({ equipmentId: equipment.id, type: "repair", status: "open", date: "2026-07-27", description: "强制删除维修" }, actor);
  service.createProcurementRecord({ equipmentId: equipment.id, vendor: "强制删除供应商", date: "2026-07-27", amount: 100, status: "accepted" }, actor);

  assert.throws(
    () => service.removeEquipment(equipment.id),
    (error) => error instanceof AppError
      && error.status === 409
      && error.code === "EQUIPMENT_HAS_HISTORY"
      && error.details.reservations === 1
      && error.details.maintenance === 1
      && error.details.procurement === 1
  );
  assert.throws(
    () => service.removeEquipment(equipment.id, { force: true }),
    (error) => error instanceof AppError
      && error.status === 409
      && error.code === "EQUIPMENT_HISTORY_CHANGED"
      && error.details.reservations === 1
      && error.details.maintenance === 1
      && error.details.procurement === 1
  );
  assert.deepEqual(service.removeEquipment(equipment.id, {
    force: true,
    expectedHistory: { reservations: 1, maintenance: 1, procurement: 1 }
  }), {
    id: equipment.id,
    removed: true,
    forced: true,
    deleted: { reservations: 1, maintenance: 1, procurement: 1 }
  });
  assert.equal(database.prepare("SELECT COUNT(*) AS count FROM reservations WHERE equipment_id = ?").get(equipment.id).count, 0);
  assert.equal(database.prepare("SELECT COUNT(*) AS count FROM maintenance_records WHERE equipment_id = ?").get(equipment.id).count, 0);
  assert.equal(database.prepare("SELECT COUNT(*) AS count FROM procurement_records WHERE equipment_id = ?").get(equipment.id).count, 0);
  assert.equal(service.listEquipment().length, 0);
  database.close();
});

test("rolls back a failed forced equipment removal", () => {
  const { database, service, equipment } = fixture();
  const actor = service.createUser({ displayName: "回滚成员", username: "forcedeleterollback", role: "member" });
  service.createReservation({ equipmentId: equipment.id, date: futureDate(22), start: "09:00", end: "10:00", people: 1, purpose: "回滚预约" }, actor);
  database.exec(`
    CREATE TRIGGER fail_forced_equipment_delete
    BEFORE DELETE ON equipment
    WHEN OLD.id = '${equipment.id}'
    BEGIN
      SELECT RAISE(ABORT, 'force_delete_failure');
    END;
  `);

  assert.throws(
    () => service.removeEquipment(equipment.id, { force: true, expectedHistory: { reservations: 1, maintenance: 0, procurement: 0 } }),
    /force_delete_failure/
  );
  assert.equal(service.getEquipment(equipment.id).id, equipment.id);
  assert.equal(database.prepare("SELECT COUNT(*) AS count FROM reservations WHERE equipment_id = ?").get(equipment.id).count, 1);
  database.close();
});

test("requires a current history snapshot before force-removing equipment", () => {
  const { database, service, equipment } = fixture();
  const actor = service.createUser({ displayName: "竞态删除成员", username: "forcedeleterace", role: "member" });
  service.createReservation({ equipmentId: equipment.id, date: futureDate(24), start: "09:00", end: "10:00", people: 1, purpose: "竞态预约" }, actor);
  const expectedHistory = { reservations: 1, maintenance: 0, procurement: 0 };
  service.createMaintenanceRecord({ equipmentId: equipment.id, type: "repair", status: "open", date: "2026-07-27", description: "新增竞态维修" }, actor);

  assert.throws(
    () => service.removeEquipment(equipment.id, { force: true, expectedHistory }),
    (error) => error instanceof AppError
      && error.status === 409
      && error.code === "EQUIPMENT_HISTORY_CHANGED"
      && error.details.reservations === 1
      && error.details.maintenance === 1
      && error.details.procurement === 0
  );
  assert.equal(service.getEquipment(equipment.id).id, equipment.id);
  assert.equal(database.prepare("SELECT COUNT(*) AS count FROM reservations WHERE equipment_id = ?").get(equipment.id).count, 1);
  assert.equal(database.prepare("SELECT COUNT(*) AS count FROM maintenance_records WHERE equipment_id = ?").get(equipment.id).count, 1);

  assert.deepEqual(service.removeEquipment(equipment.id, {
    force: true,
    expectedHistory: { reservations: 1, maintenance: 1, procurement: 0 }
  }).deleted, { reservations: 1, maintenance: 1, procurement: 0 });
  database.close();
});

test("creates, lists, and validates maintenance and procurement records", () => {
  const { database, service, equipment } = fixture();
  const actor = service.createUser({ displayName: "业务成员", username: "recordmember", role: "member" });

  const maintenance = service.createMaintenanceRecord({
    equipmentId: equipment.id,
    type: "maintenance",
    status: "completed",
    date: "2026-07-27",
    description: "完成光路校准与清洁",
    cost: 320.5
  }, actor);
  const procurement = service.createProcurementRecord({
    equipmentId: equipment.id,
    vendor: "测试供应商",
    date: "2026-07-26",
    amount: "12800",
    status: "accepted",
    notes: "含两年质保"
  }, actor);

  assert.deepEqual(service.listMaintenanceRecords({ equipmentId: equipment.id }).map((record) => record.id), [maintenance.id]);
  assert.equal(maintenance.equipmentName, "测试光谱仪");
  assert.equal(maintenance.createdByUserId, actor.id);
  assert.equal(maintenance.cost, 320.5);
  assert.deepEqual(service.listProcurementRecords({ equipmentId: equipment.id }).map((record) => record.id), [procurement.id]);
  assert.equal(procurement.vendor, "测试供应商");
  assert.equal(procurement.amount, 12800);
  assert.equal(procurement.createdByName, "业务成员");
  assert.equal(service.updateProcurementRecordStatus(procurement.id, { status: "rejected" }).status, "rejected");
  assert.throws(
    () => service.updateProcurementRecordStatus(procurement.id, { status: "other" }),
    (error) => error instanceof AppError && error.code === "VALIDATION_ERROR"
  );
  assert.throws(
    () => service.createMaintenanceRecord({ ...maintenance, equipmentId: "missing", date: "2026-07-27" }, actor),
    (error) => error instanceof AppError && error.code === "EQUIPMENT_NOT_FOUND"
  );
  assert.throws(
    () => service.createProcurementRecord({ equipmentId: equipment.id, vendor: "供应商", date: "2026-02-31", amount: 1, status: "pending" }, actor),
    (error) => error instanceof AppError && error.code === "INVALID_RECORD_DATE"
  );
  assert.throws(
    () => service.createProcurementRecord({ equipmentId: equipment.id, vendor: "供应商", date: "2026-07-27", amount: -1, status: "pending" }, actor),
    (error) => error instanceof AppError && error.code === "VALIDATION_ERROR"
  );
  assert.throws(
    () => service.createMaintenanceRecord({ equipmentId: equipment.id, type: "other", status: "open", date: "2026-07-27", description: "错误类型" }, actor),
    (error) => error instanceof AppError && error.code === "VALIDATION_ERROR"
  );
  assert.throws(
    () => service.createProcurementRecord({ equipmentId: equipment.id, vendor: "供应商", date: "2026-07-27", amount: 1, status: "other" }, actor),
    (error) => error instanceof AppError && error.code === "VALIDATION_ERROR"
  );
  database.close();
});

test("keeps equipment status synchronized with active maintenance records", () => {
  const { database, service, equipment } = fixture();
  const actor = service.createUser({ displayName: "维修成员", username: "repairmember", role: "member" });
  const first = service.createMaintenanceRecord({
    equipmentId: equipment.id,
    type: "repair",
    status: "open",
    date: "2026-07-27",
    description: "排查故障"
  }, actor);
  const second = service.createMaintenanceRecord({
    equipmentId: equipment.id,
    type: "maintenance",
    status: "in_progress",
    date: "2026-07-27",
    description: "同步保养"
  }, actor);

  assert.equal(service.getEquipment(equipment.id).status, "maintenance");
  assert.throws(
    () => service.updateEquipmentStatus(equipment.id, { status: "available" }),
    (error) => error instanceof AppError && error.status === 409 && error.code === "EQUIPMENT_HAS_ACTIVE_MAINTENANCE"
  );
  assert.equal(service.updateMaintenanceRecordStatus(first.id, { status: "completed" }).equipmentStatus, "maintenance");
  assert.equal(service.updateMaintenanceRecordStatus(second.id, { status: "completed" }).equipmentStatus, "available");
  assert.equal(service.getEquipment(equipment.id).status, "available");
  database.close();
});

test("does not restore disabled or retired equipment when maintenance completes", () => {
  for (const protectedStatus of ["disabled", "retired"]) {
    const { database, service, equipment } = fixture();
    const actor = service.createUser({ displayName: "维修成员", username: `repair${protectedStatus}`, role: "member" });
    const record = service.createMaintenanceRecord({
      equipmentId: equipment.id,
      type: "repair",
      status: "open",
      date: "2026-07-27",
      description: "排查故障"
    }, actor);
    service.updateEquipmentStatus(equipment.id, { status: protectedStatus });
    service.updateMaintenanceRecordStatus(record.id, { status: "completed" });
    assert.equal(service.getEquipment(equipment.id).status, protectedStatus);
    database.close();
  }
});

test("persists an immediately active reservation", () => {
  const { database, service, equipment } = fixture();
  const date = futureDate(7);
  const reservation = service.createReservation({ equipmentId: equipment.id, date, start: "09:00", end: "11:00", people: 2, purpose: "测试预约", requesterName: "陈同学", requesterLab: "测试实验室" });
  assert.equal(reservation.status, "approved");
  assert.equal(service.listReservations({ date }).length, 1);
  database.close();
});

test("derives equipment reservation lifecycle and rejects expired operations", () => {
  const { database, service, equipment } = fixture();
  const member = service.createUser({ displayName: "生命周期成员", username: "lifecyclereservation", role: "member" });

  assert.throws(
    () => service.createReservation({
      equipmentId: equipment.id,
      date: todayInShanghai(),
      start: "00:00",
      end: "23:59",
      people: 1,
      purpose: "过期开始时间"
    }, member),
    (error) => error instanceof AppError && error.code === "PAST_RESERVATION_TIME"
  );

  const reservation = service.createReservation({
    equipmentId: equipment.id,
    date: futureDate(6),
    start: "09:00",
    end: "10:00",
    people: 1,
    purpose: "生命周期验证"
  }, member);
  const now = Date.now();
  database.prepare("UPDATE reservations SET start_at = ?, end_at = ? WHERE id = ?")
    .run(new Date(now - 60_000).toISOString(), new Date(now + 60_000).toISOString(), reservation.id);

  assert.equal(service.listReservations().find((item) => item.id === reservation.id).status, "in_use");
  assert.throws(
    () => service.cancelReservation(reservation.id, member),
    (error) => error instanceof AppError && error.code === "RESERVATION_ALREADY_STARTED"
  );

  database.prepare("UPDATE reservations SET start_at = ?, end_at = ? WHERE id = ?")
    .run(new Date(now - 120_000).toISOString(), new Date(now - 60_000).toISOString(), reservation.id);
  assert.equal(service.listReservations().find((item) => item.id === reservation.id).status, "completed");
  assert.throws(
    () => service.cancelReservation(reservation.id, member),
    (error) => error instanceof AppError && error.code === "RESERVATION_ALREADY_COMPLETED"
  );
  database.close();
});

test("seeds a meeting room and enforces direct room booking conflicts", () => {
  const database = createDatabase(":memory:");
  const service = createService(database);
  const member = service.listUsers().find((user) => user.username === "member01");
  const room = service.listMeetingRooms().find((item) => item.name === "3楼会议室");
  const date = futureDate(12);
  assert.equal(room.capacity, 12);
  assert.equal(room.active, true);

  const first = service.createRoomReservation({
    meetingRoomId: room.id, date, start: "09:00", end: "10:30", people: 12, purpose: "组会"
  }, member);
  assert.equal(first.status, "approved");
  assert.equal(first.requesterUserId, member.id);
  assert.throws(
    () => service.createRoomReservation({ meetingRoomId: room.id, date, start: "10:00", end: "11:00", people: 1, purpose: "冲突" }, member),
    (error) => error instanceof AppError && error.code === "ROOM_RESERVATION_CONFLICT"
  );
  assert.throws(
    () => service.createRoomReservation({ meetingRoomId: room.id, date, start: "11:00", end: "12:00", people: 13, purpose: "超员" }, member),
    (error) => error instanceof AppError && error.code === "VALIDATION_ERROR"
  );
  database.close();
});

test("derives meeting-room reservation lifecycle and rejects expired operations", () => {
  const database = createDatabase(":memory:");
  const service = createService(database);
  const member = service.listUsers().find((user) => user.username === "member01");
  const room = service.listMeetingRooms()[0];

  assert.throws(
    () => service.createRoomReservation({
      meetingRoomId: room.id,
      date: todayInShanghai(),
      start: "00:00",
      end: "23:59",
      people: 1,
      purpose: "过期会议"
    }, member),
    (error) => error instanceof AppError && error.code === "PAST_RESERVATION_TIME"
  );

  const reservation = service.createRoomReservation({
    meetingRoomId: room.id,
    date: futureDate(7),
    start: "14:00",
    end: "15:00",
    people: 2,
    purpose: "会议生命周期验证"
  }, member);
  const now = Date.now();
  database.prepare("UPDATE room_reservations SET start_at = ?, end_at = ? WHERE id = ?")
    .run(new Date(now - 60_000).toISOString(), new Date(now + 60_000).toISOString(), reservation.id);

  assert.equal(service.listRoomReservations().find((item) => item.id === reservation.id).status, "in_use");
  assert.throws(
    () => service.cancelRoomReservation(reservation.id, member),
    (error) => error instanceof AppError && error.code === "ROOM_RESERVATION_ALREADY_STARTED"
  );

  database.prepare("UPDATE room_reservations SET start_at = ?, end_at = ? WHERE id = ?")
    .run(new Date(now - 120_000).toISOString(), new Date(now - 60_000).toISOString(), reservation.id);
  assert.equal(service.listRoomReservations().find((item) => item.id === reservation.id).status, "completed");
  assert.throws(
    () => service.cancelRoomReservation(reservation.id, member),
    (error) => error instanceof AppError && error.code === "ROOM_RESERVATION_ALREADY_COMPLETED"
  );
  database.close();
});

test("room reservation cancellation respects ownership and update trigger prevents overlap", () => {
  const database = createDatabase(":memory:");
  const service = createService(database);
  const owner = service.listUsers().find((user) => user.username === "member01");
  const developer = service.listUsers().find((user) => user.username === "developer");
  const other = service.createUser({ displayName: "其他成员", username: "roomother", role: "member" });
  const room = service.listMeetingRooms()[0];
  const date = futureDate(13);
  const first = service.createRoomReservation({ meetingRoomId: room.id, date, start: "09:00", end: "11:00", people: 2, purpose: "第一场" }, owner);
  const second = service.createRoomReservation({ meetingRoomId: room.id, date, start: "11:00", end: "12:00", people: 2, purpose: "第二场" }, owner);
  assert.throws(
    () => service.cancelRoomReservation(first.id, other),
    (error) => error instanceof AppError && error.code === "ROOM_RESERVATION_CANCEL_FORBIDDEN"
  );
  service.cancelRoomReservation(second.id, owner);
  database.prepare("UPDATE room_reservations SET start_at = ?, start_time = ? WHERE id = ?").run(first.startAt, "09:30", second.id);
  assert.throws(
    () => database.prepare("UPDATE room_reservations SET status = 'approved' WHERE id = ?").run(second.id),
    /room_reservation_conflict/
  );
  assert.equal(service.cancelRoomReservation(first.id, developer).status, "cancelled");
  database.close();
});

test("manages meeting rooms and protects rooms with future reservations", () => {
  const database = createDatabase(":memory:");
  const service = createService(database);
  const developer = service.listUsers().find((user) => user.username === "developer");
  const member = service.listUsers().find((user) => user.username === "member01");
  const room = service.createMeetingRoom({ name: "4楼研讨室", code: "room-4f", capacity: 8, location: "4楼东侧" }, developer);
  assert.equal(room.code, "ROOM-4F");
  assert.equal(service.listMeetingRooms().some((item) => item.id === room.id), true);
  const updated = service.updateMeetingRoom(room.id, { name: "4楼会议室", capacity: 10 }, developer);
  assert.equal(updated.name, "4楼会议室");
  assert.equal(updated.capacity, 10);
  service.createRoomReservation({ meetingRoomId: room.id, date: futureDate(20), start: "09:00", end: "10:00", people: 3, purpose: "未来会议" }, member);
  assert.throws(
    () => service.updateMeetingRoom(room.id, { capacity: 2 }, developer),
    (error) => error instanceof AppError && error.code === "MEETING_ROOM_CAPACITY_CONFLICT" && error.details.conflictingReservations === 1 && error.details.maximumReservedPeople === 3
  );
  assert.throws(
    () => database.prepare("UPDATE meeting_rooms SET capacity = 2 WHERE id = ?").run(room.id),
    /meeting_room_capacity_conflict/
  );
  assert.throws(
    () => database.prepare("UPDATE meeting_rooms SET is_active = 0 WHERE id = ?").run(room.id),
    /meeting_room_has_future_reservations/
  );
  assert.throws(
    () => service.updateMeetingRoom(room.id, { active: false }, developer),
    (error) => error instanceof AppError && error.code === "MEETING_ROOM_HAS_FUTURE_RESERVATIONS" && error.details.futureReservations === 1
  );
  database.prepare("UPDATE room_reservations SET status = 'cancelled' WHERE meeting_room_id = ?").run(room.id);
  const disabled = service.updateMeetingRoom(room.id, { active: false, capacity: 2 }, developer);
  assert.equal(disabled.active, false);
  assert.equal(disabled.capacity, 2);
  assert.throws(
    () => service.createRoomReservation({ meetingRoomId: room.id, date: futureDate(21), start: "09:00", end: "10:00", people: 3, purpose: "停用会议室" }, member),
    (error) => error instanceof AppError && error.code === "MEETING_ROOM_UNAVAILABLE"
  );
  assert.equal(service.listMeetingRooms().some((item) => item.id === room.id), false);
  assert.equal(service.listMeetingRooms({ includeInactive: true }).some((item) => item.id === room.id), true);
  assert.throws(
    () => service.createMeetingRoom({ name: "4楼会议室", code: "OTHER", capacity: 1 }, developer),
    (error) => error instanceof AppError && error.code === "MEETING_ROOM_EXISTS"
  );
  assert.throws(
    () => service.updateMeetingRoom(room.id, { active: "true" }, developer),
    (error) => error instanceof AppError && error.code === "VALIDATION_ERROR"
  );
  database.close();
});

test("database rejects reactivating a room reservation above the current capacity", () => {
  const database = createDatabase(":memory:");
  const service = createService(database);
  const developer = service.listUsers().find((user) => user.username === "developer");
  const member = service.listUsers().find((user) => user.username === "member01");
  const room = service.createMeetingRoom({ name: "容量恢复测试室", code: "CAPACITY-RESTORE", capacity: 3 }, developer);
  const reservation = service.createRoomReservation({ meetingRoomId: room.id, date: futureDate(22), start: "09:00", end: "10:00", people: 3, purpose: "容量恢复测试" }, member);
  service.cancelRoomReservation(reservation.id, member);
  service.updateMeetingRoom(room.id, { capacity: 2 }, developer);

  assert.throws(
    () => database.prepare("UPDATE room_reservations SET status = 'approved' WHERE id = ?").run(reservation.id),
    /meeting_room_capacity_exceeded/
  );
  database.close();
});

test("paginates and filters growing operational records", () => {
  const { database, service, equipment } = fixture();
  const actor = service.createUser({ displayName: "分页成员", username: "paginationmember", role: "member" });
  for (let index = 1; index <= 5; index += 1) {
    service.createMaintenanceRecord({ equipmentId: equipment.id, type: index % 2 ? "repair" : "maintenance", status: index <= 3 ? "open" : "completed", date: `2026-07-${String(index).padStart(2, "0")}`, description: `分页维修 ${index}` }, actor);
    service.createProcurementRecord({ equipmentId: equipment.id, vendor: `分页供应商 ${index}`, date: `2026-06-${String(index).padStart(2, "0")}`, amount: index, status: index <= 2 ? "pending" : "accepted" }, actor);
  }
  const maintenance = service.listMaintenanceRecords({ paginated: true, page: 2, pageSize: 2, status: "open" });
  assert.deepEqual(maintenance.pagination, { page: 2, pageSize: 2, total: 3, totalPages: 2 });
  assert.equal(maintenance.items.length, 1);
  const procurement = service.listProcurementRecords({ paginated: true, page: 1, pageSize: 2, status: "accepted", dateFrom: "2026-06-03" });
  assert.equal(procurement.pagination.total, 3);
  assert.equal(procurement.items.length, 2);
  assert.throws(
    () => service.listMaintenanceRecords({ paginated: true, page: 0 }),
    (error) => error instanceof AppError && error.code === "VALIDATION_ERROR"
  );
  database.close();
});

test("filters paginated audit logs", () => {
  const { database, service, equipment } = fixture();
  const admin = service.createUser({ displayName: "健康管理员", username: "healthadmin", role: "admin" });
  service.updateEquipment(equipment.id, { owner: "健康检查保管人" }, admin);
  database.prepare("UPDATE audit_logs SET created_at = ? WHERE entity_type = 'equipment' AND entity_id = ?").run("2026-07-28T16:30:00.000Z", equipment.id);
  const audit = service.listAuditLogs(admin, { paginated: true, page: 1, pageSize: 10, query: "健康检查", entityType: "equipment", dateFrom: "2026-07-29", dateTo: "2026-07-29" });
  assert.equal(audit.pagination.total, 1);
  assert.equal(audit.items[0].action, "equipment.update");
  assert.equal(service.listAuditLogs(admin, { paginated: true, entityType: "equipment", dateFrom: "2026-07-28", dateTo: "2026-07-28" }).pagination.total, 0);
  database.close();
});

test("rejects overlapping reservations at the database boundary", () => {
  const { database, service, equipment } = fixture();
  const base = { equipmentId: equipment.id, date: futureDate(8), people: 1, purpose: "测试预约", requesterName: "陈同学", requesterLab: "测试实验室" };
  service.createReservation({ ...base, start: "09:00", end: "11:00" });
  assert.throws(
    () => service.createReservation({ ...base, start: "10:30", end: "12:00" }),
    (error) => error instanceof AppError && error.status === 409 && error.code === "RESERVATION_CONFLICT"
  );
  assert.doesNotThrow(() => service.createReservation({ ...base, start: "11:00", end: "12:00" }));
  database.close();
});

test("rejects reservations for equipment under maintenance", () => {
  const { database, service } = fixture();
  const maintenanceEquipment = service.createEquipment({ name: "维修设备", code: "CIPC-TEST-002", metric: "x", lab: "测试实验室", location: "T-103", owner: "测试老师", status: "maintenance" });
  assert.throws(
    () => service.createReservation({ equipmentId: maintenanceEquipment.id, date: futureDate(9), start: "09:00", end: "10:00", people: 1, purpose: "测试预约" }),
    (error) => error instanceof AppError && error.status === 409 && error.code === "EQUIPMENT_UNAVAILABLE"
  );
  database.close();
});

test("rejects impossible calendar dates", () => {
  const { database, service, equipment } = fixture();
  assert.throws(
    () => service.createReservation({ equipmentId: equipment.id, date: "2026-02-31", start: "09:00", end: "10:00", people: 1, purpose: "无效日期" }),
    (error) => error instanceof AppError && error.code === "INVALID_RESERVATION_DATE"
  );
  database.close();
});

test("seeds the approved laboratories and login accounts without demo equipment", () => {
  const database = createDatabase(":memory:");
  const service = createService(database);
  const users = service.listUsers();
  const names = users.map((user) => user.displayName);

  assert.equal(service.listLaboratories().length, 8);
  assert.equal(users.length, 21);
  assert.deepEqual([...new Set(users.map((user) => user.role))].sort(), ["developer", "member"]);
  assert.equal(service.listEquipment().length, 0);
  assert.equal(service.listReservations().length, 0);
  assert.ok(names.includes("测试成员01"));
  assert.ok(names.includes("测试成员20"));
  assert.equal(users.find((user) => user.displayName === "测试成员01").username, "member01");
  assert.equal(users.find((user) => user.displayName === "测试成员09").username, "member09");
  assert.equal(users.find((user) => user.displayName === "测试成员05").username, "member05");
  assert.ok(!names.includes("白连山"));
  assert.ok(!names.includes("邱喜华"));
  assert.ok(!names.includes("敬波"));
  assert.ok(!names.includes("谭庆泽"));
  database.close();
});

test("production seed mode keeps reference data but omits demo users", () => {
  const database = createDatabase(":memory:", { seedReferenceData: true, seedUsers: false });
  const service = createService(database);
  assert.equal(service.listLaboratories().length, 8);
  assert.equal(service.listMeetingRooms().length, 1);
  assert.equal(service.listUsers().length, 0);
  database.close();
});

test("requires an initial password change, rotates credentials, and revokes old sessions", async () => {
  const database = createDatabase(":memory:");
  const service = createService(database);
  const user = await service.authenticate("developer", "123456");
  const session = service.createSession(user.id);

  assert.equal(user.mustChangePassword, true);
  assert.equal(service.getSessionUser(session.token).username, "developer");

  const changed = await service.changePassword(user.id, "123456", "CipcTest2026");
  assert.equal(changed.mustChangePassword, false);
  assert.throws(
    () => service.getSessionUser(session.token),
    (error) => error instanceof AppError && error.code === "SESSION_EXPIRED"
  );
  await assert.rejects(
    service.authenticate("developer", "123456"),
    (error) => error instanceof AppError && error.code === "INVALID_CREDENTIALS"
  );
  assert.equal((await service.authenticate("developer", "CipcTest2026")).username, "developer");
  database.close();
});

test("creates a member account with the initial password and validates uniqueness", async () => {
  const database = createDatabase(":memory:");
  const service = createService(database);
  const laboratory = service.listLaboratories()[0];

  const user = service.createUser({
    displayName: "测试成员",
    username: "testmember",
    role: "member",
    laboratoryId: laboratory.id
  });

  assert.equal(user.username, "testmember");
  assert.equal(user.role, "member");
  assert.equal(user.laboratoryId, laboratory.id);
  assert.equal(user.mustChangePassword, true);
  assert.equal((await service.authenticate("testmember", "123456")).id, user.id);
  assert.throws(
    () => service.createUser({ displayName: "重复成员", username: "TESTMEMBER", role: "member" }),
    (error) => error instanceof AppError && error.status === 409 && error.code === "USERNAME_EXISTS"
  );
  assert.throws(
    () => service.createUser({ displayName: "错误成员", username: "bad-name", role: "member" }),
    (error) => error instanceof AppError && error.code === "INVALID_USERNAME"
  );
  assert.throws(
    () => service.createUser({ displayName: "开发者", username: "newdeveloper", role: "developer" }),
    (error) => error instanceof AppError && error.code === "INVALID_ROLE"
  );

  database.close();
});

test("updates member identity and role, then resets to a random temporary password", async () => {
  const database = createDatabase(":memory:");
  const service = createService(database);
  const laboratories = service.listLaboratories();
  const developer = service.listUsers().find((user) => user.role === "developer");
  const admin = service.createUser({ displayName: "测试管理员", username: "testadmin", role: "admin" });
  const member = service.createUser({
    displayName: "原成员",
    username: "originalmember",
    role: "member",
    laboratoryId: laboratories[0].id
  });
  await service.changePassword(member.id, "123456", "Original2026");
  const memberSession = service.createSession(member.id);

  const updated = service.updateUser(member.id, {
    displayName: "新成员姓名",
    username: "RenamedMember",
    role: "admin",
    laboratoryId: laboratories[1].id
  }, admin);

  assert.equal(updated.displayName, "新成员姓名");
  assert.equal(updated.username, "renamedmember");
  assert.equal(updated.role, "admin");
  assert.equal(updated.laboratoryId, laboratories[1].id);
  assert.equal(service.getSessionUser(memberSession.token).role, "admin");
  await assert.rejects(
    service.authenticate("originalmember", "Original2026"),
    (error) => error instanceof AppError && error.code === "INVALID_CREDENTIALS"
  );
  assert.equal((await service.authenticate("renamedmember", "Original2026")).id, member.id);
  assert.throws(
    () => service.updateUser(member.id, { ...updated, username: "member01" }, admin),
    (error) => error instanceof AppError && error.code === "USERNAME_EXISTS"
  );
  assert.throws(
    () => service.updateUser(admin.id, { ...admin, role: "member" }, admin),
    (error) => error instanceof AppError && error.code === "SELF_ROLE_CHANGE_FORBIDDEN"
  );
  assert.throws(
    () => service.updateUser(developer.id, { ...developer, displayName: "被修改" }, admin),
    (error) => error instanceof AppError && error.code === "DEVELOPER_ACCOUNT_PROTECTED"
  );

  const reset = service.resetUserPassword(member.id, developer);
  assert.equal(reset.user.mustChangePassword, true);
  assert.equal(reset.user.passwordChangedAt, null);
  assert.match(reset.temporaryPassword, /^[A-Za-z0-9_-]{12,}$/);
  assert.throws(
    () => service.getSessionUser(memberSession.token),
    (error) => error instanceof AppError && error.code === "SESSION_EXPIRED"
  );
  await assert.rejects(
    service.authenticate("renamedmember", "Original2026"),
    (error) => error instanceof AppError && error.code === "INVALID_CREDENTIALS"
  );
  await assert.rejects(
    service.authenticate("renamedmember", "123456"),
    (error) => error instanceof AppError && error.code === "INVALID_CREDENTIALS"
  );
  assert.equal((await service.authenticate("renamedmember", reset.temporaryPassword)).mustChangePassword, true);
  assert.throws(
    () => service.resetUserPassword(developer.id, developer),
    (error) => error instanceof AppError && error.code === "SELF_PASSWORD_RESET_FORBIDDEN"
  );

  database.close();
});

test("allows a member to cancel their own reservation and releases the time slot", () => {
  const { database, service, equipment } = fixture();
  const member = service.createUser({ displayName: "预约成员", username: "bookingmember", role: "member" });
  const input = { equipmentId: equipment.id, date: futureDate(10), start: "09:00", end: "11:00", people: 1, purpose: "测试取消" };
  const reservation = service.createReservation(input, member);

  const cancelled = service.cancelReservation(reservation.id, member);
  assert.equal(cancelled.status, "cancelled");
  assert.doesNotThrow(() => service.createReservation(input, member));
  database.close();
});

test("prevents another member from cancelling a reservation", () => {
  const { database, service, equipment } = fixture();
  const owner = service.createUser({ displayName: "预约人", username: "reservationowner", role: "member" });
  const other = service.createUser({ displayName: "其他成员", username: "othermember", role: "member" });
  const reservation = service.createReservation({ equipmentId: equipment.id, date: futureDate(11), start: "09:00", end: "10:00", people: 1, purpose: "权限检查" }, owner);

  assert.throws(
    () => service.cancelReservation(reservation.id, other),
    (error) => error instanceof AppError && error.code === "RESERVATION_CANCEL_FORBIDDEN"
  );
  database.close();
});

test("blocks overlap when an existing reservation is updated back to an active status", () => {
  const { database, service, equipment } = fixture();
  const member = service.createUser({ displayName: "预约成员", username: "updatemember", role: "member" });
  const date = futureDate(12);
  const first = service.createReservation({ equipmentId: equipment.id, date, start: "09:00", end: "11:00", people: 1, purpose: "第一条" }, member);
  const second = service.createReservation({ equipmentId: equipment.id, date, start: "11:00", end: "12:00", people: 1, purpose: "第二条" }, member);
  service.cancelReservation(second.id, member);
  database.prepare("UPDATE reservations SET start_at = ?, start_time = ? WHERE id = ?").run(first.startAt, "09:30", second.id);

  assert.throws(
    () => database.prepare("UPDATE reservations SET status = 'approved' WHERE id = ?").run(second.id),
    /reservation_conflict/
  );
  database.close();
});

test("reopening a seeded database preserves equipment and reservations", () => {
  const directory = mkdtempSync(join(tmpdir(), "cipc-db-reopen-"));
  const filePath = join(directory, "app.sqlite");

  try {
    let database = createDatabase(filePath);
    let service = createService(database);
    const equipment = service.createEquipment({
      name: "持久化设备",
      code: "CIPC-PERSIST-001",
      metric: "测试指标",
      lab: "低空通信与遥感实验室",
      owner: "测试成员01",
      status: "available"
    });
    const member = service.listUsers().find((user) => user.username === "member01");
    const reservation = service.createReservation({
      equipmentId: equipment.id,
      date: futureDate(20),
      start: "09:00",
      end: "10:00",
      people: 1,
      purpose: "持久化验证"
    }, member);
    database.close();

    database = createDatabase(filePath);
    service = createService(database);
    assert.equal(service.listEquipment().some((item) => item.id === equipment.id), true);
    assert.equal(service.listReservations().some((item) => item.id === reservation.id), true);
    assert.equal(service.listReservations().find((item) => item.id === reservation.id).status, "approved");
    database.close();
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("reconciles active maintenance records when reopening the database", () => {
  const directory = mkdtempSync(join(tmpdir(), "cipc-maintenance-reconcile-"));
  const filePath = join(directory, "app.sqlite");

  try {
    let database = createDatabase(filePath, { seed: false });
    let service = createService(database);
    const equipment = service.createEquipment({
      name: "待纠正设备",
      code: "CIPC-RECONCILE-001",
      metric: "测试指标",
      lab: "测试实验室",
      owner: "测试老师"
    });
    const actor = service.createUser({ displayName: "维修成员", username: "reconcilemember", role: "member" });
    service.createMaintenanceRecord({
      equipmentId: equipment.id,
      type: "repair",
      status: "open",
      date: "2026-07-27",
      description: "等待处理"
    }, actor);
    database.exec("DROP TRIGGER equipment_prevent_active_maintenance_override");
    database.prepare("UPDATE equipment SET status = 'available' WHERE id = ?").run(equipment.id);
    database.close();

    database = createDatabase(filePath, { seed: false });
    service = createService(database);
    assert.equal(service.getEquipment(equipment.id).status, "maintenance");
    database.close();
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("database rejects removed roles and approval states", () => {
  const { database, service, equipment } = fixture();
  const member = service.createUser({ displayName: "角色验证", username: "rolecheck", role: "member" });
  const reservation = service.createReservation({
    equipmentId: equipment.id,
    date: futureDate(21),
    start: "09:00",
    end: "10:00",
    people: 1,
    purpose: "状态验证"
  }, member);

  assert.throws(() => database.prepare("UPDATE users SET role = 'custodian' WHERE id = ?").run(member.id));
  assert.throws(() => database.prepare("UPDATE reservations SET status = 'pending' WHERE id = ?").run(reservation.id));
  assert.throws(() => database.prepare("UPDATE reservations SET status = 'rejected' WHERE id = ?").run(reservation.id));
  database.close();
});

test("records sanitized audit entries atomically and scopes audit visibility by role", async () => {
  const { database, service, equipment } = fixture();
  const member = service.createUser({ displayName: "审计成员", username: "auditmember", role: "member" });
  const admin = service.createUser({ displayName: "审计管理员", username: "auditadmin", role: "admin" });
  const reservation = service.createReservation({
    equipmentId: equipment.id, date: futureDate(30), start: "09:00", end: "10:00", people: 1, purpose: "审计预约"
  }, member);
  const changed = await service.changePassword(member.id, "123456", "AuditMember2026");

  const own = service.listAuditLogs(member);
  assert.ok(own.length >= 2);
  assert.ok(own.every((item) => item.actorUserId === member.id));
  assert.equal(own.some((item) => item.entityId === reservation.id && item.action === "reservation.create"), true);
  assert.equal(own.some((item) => item.action === "user.password_change"), true);
  assert.equal(JSON.stringify(own).includes("AuditMember2026"), false);
  assert.equal(JSON.stringify(own).includes("password_hash"), false);
  assert.equal(JSON.stringify(own).includes("token"), false);
  assert.equal(service.listAuditLogs(admin).length >= own.length, true);
  assert.equal(changed.id, member.id);

  const auditBeforeFailure = service.listAuditLogs(admin).length;
  assert.throws(() => service.createEquipment({ name: "测试光谱仪", code: equipment.code, metric: "重复", lab: "测试实验室", owner: "测试老师" }, member));
  assert.equal(service.listAuditLogs(admin).length, auditBeforeFailure);
  database.close();
});

test("merges only the current user's equipment and room reservations with effective statuses", () => {
  const database = createDatabase(":memory:");
  const service = createService(database);
  const member = service.listUsers().find((user) => user.username === "member01");
  const other = service.createUser({ displayName: "其他预约人", username: "otherbooking", role: "member" });
  const equipment = service.createEquipment({ name: "个人预约设备", code: "CIPC-MY-RESERVATION", metric: "测试", lab: "量子实验室", owner: "测试成员01" }, member);
  const room = service.listMeetingRooms()[0];
  const ownEquipment = service.createReservation({ equipmentId: equipment.id, date: futureDate(30), start: "09:00", end: "10:00", people: 1, purpose: "我的设备预约" }, member);
  const ownRoom = service.createRoomReservation({ meetingRoomId: room.id, date: futureDate(31), start: "10:00", end: "11:00", people: 2, purpose: "我的会议预约" }, member);
  service.createReservation({ equipmentId: equipment.id, date: futureDate(32), start: "09:00", end: "10:00", people: 1, purpose: "其他人的预约" }, other);
  service.cancelReservation(ownEquipment.id, member);

  const mine = service.listMyReservations(member);
  assert.deepEqual(mine.map((item) => item.id).sort(), [ownEquipment.id, ownRoom.id].sort());
  assert.equal(mine.find((item) => item.id === ownEquipment.id).resourceType, "equipment");
  assert.equal(mine.find((item) => item.id === ownRoom.id).resourceType, "meeting_room");
  assert.equal(service.listMyReservations(member, { status: "cancelled" }).map((item) => item.id)[0], ownEquipment.id);
  assert.deepEqual(service.listMyReservations(member, { status: "approved" }).map((item) => item.id), [ownRoom.id]);
  database.close();
});

test("audits every supported business mutation without credential material", async () => {
  const database = createDatabase(":memory:");
  const service = createService(database);
  const developer = service.listUsers().find((user) => user.username === "developer");
  const laboratory = service.listLaboratories()[0];
  const member = service.createUser({ displayName: "完整审计成员", username: "fullauditmember", role: "member", laboratoryId: laboratory.id }, developer);
  const updatedMember = service.updateUser(member.id, { ...member, displayName: "已编辑审计成员", username: "fullauditmember2", role: "member", laboratoryId: laboratory.id }, developer);
  const reset = service.resetUserPassword(updatedMember.id, developer);
  const equipment = service.createEquipment({ name: "完整审计设备", code: "CIPC-AUDIT-ALL", metric: "测试", lab: laboratory.name, owner: "测试成员01" }, developer);
  service.updateEquipment(equipment.id, { owner: "新的保管人" }, developer);
  const maintenance = service.createMaintenanceRecord({ equipmentId: equipment.id, type: "repair", status: "open", date: "2026-07-27", description: "审计维修" }, developer);
  service.updateMaintenanceRecordStatus(maintenance.id, { status: "completed" }, developer);
  const procurement = service.createProcurementRecord({ equipmentId: equipment.id, vendor: "审计供应商", date: "2026-07-27", amount: 10, status: "pending" }, developer);
  service.updateProcurementRecordStatus(procurement.id, { status: "accepted" }, developer);
  const reservation = service.createReservation({ equipmentId: equipment.id, date: futureDate(30), start: "09:00", end: "10:00", people: 1, purpose: "审计设备预约" }, developer);
  service.cancelReservation(reservation.id, developer);
  const room = service.listMeetingRooms()[0];
  const roomReservation = service.createRoomReservation({ meetingRoomId: room.id, date: futureDate(31), start: "09:00", end: "10:00", people: 1, purpose: "审计会议室预约" }, developer);
  service.cancelRoomReservation(roomReservation.id, developer);
  const forcedEquipment = service.createEquipment({ name: "强制删除审计设备", code: "CIPC-AUDIT-FORCE", metric: "测试", lab: laboratory.name, owner: "测试成员01" }, developer);
  service.createReservation({ equipmentId: forcedEquipment.id, date: futureDate(32), start: "09:00", end: "10:00", people: 1, purpose: "强制删除历史" }, developer);
  service.removeEquipment(forcedEquipment.id, { force: true, expectedHistory: { reservations: 1, maintenance: 0, procurement: 0 } }, developer);
  service.removeEquipment(equipment.id, { force: true, expectedHistory: { reservations: 1, maintenance: 1, procurement: 1 } }, developer);
  const disposableEquipment = service.createEquipment({ name: "普通删除审计设备", code: "CIPC-AUDIT-DELETE", metric: "测试", lab: laboratory.name, owner: "测试成员01" }, developer);
  service.removeEquipment(disposableEquipment.id, {}, developer);

  const logs = service.listAuditLogs(developer);
  const actions = new Set(logs.map((item) => item.action));
  for (const action of [
    "user.create", "user.update", "user.password_reset", "equipment.create", "equipment.update", "equipment.delete", "equipment.force_delete",
    "maintenance.create", "maintenance.status_update", "procurement.create", "procurement.status_update",
    "reservation.create", "reservation.cancel", "room_reservation.create", "room_reservation.cancel"
  ]) assert.equal(actions.has(action), true, action);
  assert.equal(JSON.stringify(logs).includes(reset.temporaryPassword), false);
  database.close();
});
