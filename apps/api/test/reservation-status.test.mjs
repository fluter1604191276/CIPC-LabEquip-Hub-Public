import test from "node:test";
import assert from "node:assert/strict";
import { createDatabase } from "../lib/database.mjs";
import { createService } from "../lib/service.mjs";

const instant = Date.parse("2030-01-15T02:00:00.000Z");
const iso = (minutes) => new Date(instant + minutes * 60000).toISOString();

function fixture(t, kind) {
  const database = createDatabase(":memory:", { seed: false });
  t.after(() => database.close());
  const service = createService(database);
  const room = kind === "room";
  const resource = room
    ? service.createMeetingRoom({ name: "测试会议室", code: "STATUS-ROOM", capacity: 10 }, { role: "developer" })
    : service.createEquipment({ name: "测试设备", code: "STATUS-EQUIP", metric: "test", lab: "测试实验室", owner: "测试老师" });
  const table = room ? "room_reservations" : "reservations";
  const resourceColumn = room ? "meeting_room_id" : "equipment_id";
  const insert = database.prepare(`
    INSERT INTO ${table} (id, ${resourceColumn}, reservation_date, start_time, end_time,
      start_at, end_at, people, purpose, requester_name, requester_lab, status, created_at, updated_at)
    VALUES (?, ?, '2030-01-15', '09:00', '10:00', ?, ?, 1, 'status fixture', '演示用户', '实验室', ?, ?, ?)
  `);
  // Stored states intentionally remain stale, just as real approved bookings age.
  for (const [id, start, end, status] of [
    ["completed-1", -180, -120, "approved"],
    ["completed-2", -120, -60, "in_use"],
    ["completed-boundary", -60, 0, "approved"],
    ["in-use-boundary", 0, 60, "approved"],
    ["approved-1", 60, 120, "completed"],
    ["approved-2", 120, 180, "approved"],
    ["cancelled-past", -180, -120, "cancelled"],
    ["cancelled-future", 60, 120, "cancelled"]
  ]) {
    insert.run(id, resource.id, iso(start), iso(end), status, iso(-240), iso(-240));
  }
  const list = (filters = {}) => room
    ? service.listRoomReservations({ meetingRoomId: resource.id, ...filters })
    : service.listReservations({ equipmentId: resource.id, ...filters });
  return { list };
}

for (const kind of ["equipment", "room"]) {
  test(`${kind} status filters use effective status, including exact boundaries and cancellation`, (t) => {
    const { list } = fixture(t, kind);
    t.mock.method(Date, "now", () => instant);
    const expected = {
      approved: ["approved-1", "approved-2"],
      in_use: ["in-use-boundary"],
      completed: ["completed-1", "completed-2", "completed-boundary"],
      cancelled: ["cancelled-past", "cancelled-future"]
    };
    const all = list();
    for (const [status, ids] of Object.entries(expected)) {
      assert.deepEqual(list({ status }).map((item) => item.id), ids);
      assert.deepEqual(all.filter((item) => item.status === status).map((item) => item.id), ids);
      assert.ok(list({ status }).every((item) => item.status === status));
    }
  });

  test(`${kind} filtered pagination totals and items share one effective-status timestamp`, (t) => {
    const { list } = fixture(t, kind);
    // If mapping calls Date.now again it would turn the future records into completed.
    let clockReads = 0;
    t.mock.method(Date, "now", () => instant + (clockReads++ === 0 ? 0 : 24 * 3600000));
    const approved = list({ status: "approved", paginated: true, page: 1, pageSize: 1 });
    assert.deepEqual(approved.items.map((item) => [item.id, item.status]), [["approved-1", "approved"]]);
    assert.deepEqual(approved.pagination, { page: 1, pageSize: 1, total: 2, totalPages: 2 });
    assert.equal(clockReads, 1);
    t.mock.method(Date, "now", () => instant);
    const completed = list({ status: "completed", paginated: true, page: 2, pageSize: 2, dateFrom: "2030-01-15", dateTo: "2030-01-15" });
    assert.deepEqual(completed.items.map((item) => [item.id, item.status]), [["completed-boundary", "completed"]]);
    assert.deepEqual(completed.pagination, { page: 2, pageSize: 2, total: 3, totalPages: 2 });
  });
}
