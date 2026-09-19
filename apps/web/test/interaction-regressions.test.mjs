import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const source = readFileSync(new URL("../app.js", import.meta.url), "utf8");
function functionSource(name) {
  const match = new RegExp(`(?:async )?function ${name}\\(`).exec(source);
  assert.ok(match, `production function ${name} exists`);
  return source.slice(match.index, source.indexOf("\n}", match.index) + 2);
}
function handlerSource(selector, event = "submit") {
  const start = source.indexOf(`document.querySelector("${selector}").addEventListener("${event}"`);
  assert.notEqual(start, -1, `production handler ${selector} exists`);
  return source.slice(start, source.indexOf("\n});", start) + 4);
}
function harness(overrides = {}) {
  const nodes = new Map(), calls = [], toasts = [], closed = [];
  function node(selector) {
    if (!nodes.has(selector)) nodes.set(selector, {
      value: "example", disabled: false, hidden: false, isConnected: true, dataset: {}, textContent: "",
      addEventListener(event, handler) { this[event] = handler; },
      reset() { this.resetCount = (this.resetCount || 0) + 1; }, focus() {}, setAttribute() {}, removeAttribute() {},
      classList: { add() {}, remove() {}, toggle() {} }
    });
    return nodes.get(selector);
  }
  const context = vm.createContext({
    document: { querySelector: node, querySelectorAll: () => [], body: { classList: { add() {}, remove() {} } } },
    window: { requestAnimationFrame: (fn) => fn(), confirm: () => true },
    disposed: false, authEpoch: 0, logoutPending: false, logoutRequest: null, pendingAuthRequests: new Set(),
    logoutStorageKey: "lab-resource-logout-pending", localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    authScreen: node("#auth-screen"), passwordChangeScreen: node("#password-change-screen"),
    currentUser: { id: "me", role: "developer", username: "tester" }, currentRole: "developer",
    equipment: [], reservations: [], roomReservations: [], meetingRooms: [], laboratories: [], users: [],
    maintenanceRecords: [], procurementRecords: [], myReservations: [], reservationKind: "room",
    editingEquipment: { id: "scope" }, editingMeetingRoom: null, editingLaboratory: null, editingUser: { id: "other" }, resettingUser: { id: "other" },
    drawerEquipment: { id: "scope", status: "available" }, modal: {}, currentDate: "2099-01-01",
    apiRequest: async (path, options) => {
      calls.push({ path, options });
      if (!options?.method || options.method === "GET") throw new Error("injected refresh failure");
      return { id: "saved", username: "new-member", displayName: "成员", date: "2099-01-02", start: "09:00", status: "completed", temporaryPassword: "reset-secret" };
    },
    refreshAuditLogs: async () => { throw new Error("injected refresh failure"); },
    refreshReservationViews: async () => { throw new Error("injected refresh failure"); },
    renderAll() {}, renderAccessData() {}, renderProcurementRecords() {}, renderLaboratoryOptions() {}, renderMyReservations() {},
    renderUpcoming() {}, renderFullCalendar() {}, renderStats() {}, renderNotifications() {}, renderMeetingRooms() {},
    renderEquipmentActivity() {}, refreshReservationOptions() {}, applyMaintenanceRecord() {}, applyRoleView() {},
    openEquipmentDetail() {}, equipmentRowAction() {}, setDrawer() {}, stopGreetingRefresh() {}, stopUpdateStatusPolling() {},
    setGuideModal() {}, updateDateLabels() {}, showPasswordChange() {}, scheduleGreetingRefresh() {},
    setManagedDialog() {}, validateReservationWindow: () => true,
    reservationFormInput: () => ({ date: "2099-01-02", start: "09:00", end: "10:00", purpose: "练习", people: 1 }),
    setAuthError(element, message = "") { element.textContent = message; element.hidden = !message; },
    showToast(message, tone) { toasts.push({ message, tone }); },
    ...Object.fromEntries(["Modal", "MaintenanceModal", "ProcurementModal", "EquipmentModal", "MeetingRoomModal", "LaboratoryModal", "MemberModal", "EditMemberModal", "EditEquipmentModal", "SelfPasswordModal"].map(name => [`set${name}`, (open) => { if (!open) closed.push(name); }])),
    ...overrides
  });
  if (source.includes("function refreshAfterMutation(")) vm.runInContext(functionSource("refreshAfterMutation"), context);
  return { context, node, calls, toasts, closed, run: text => vm.runInContext(text, context) };
}

// Execute the actual DOM handlers, retaining state between the two booking paths.
test("room booking then equipment drawer submits an equipment reservation", async () => {
  const h = harness();
  h.run(functionSource("setModal"));
  h.run(functionSource("setReservationKind"));
  h.run(handlerSource("#reserve-from-drawer", "click"));
  h.run(handlerSource("#reservation-form"));
  h.node("#reservation-room").value = "room-a";
  h.context.setReservationKind("room"); h.context.setModal(true); h.context.setModal(false);
  h.node("#reserve-from-drawer").click();
  await h.node("#reservation-form").submit({ preventDefault() {}, submitter: {}, target: h.node("#reservation-form") });
  assert.equal(h.calls[0].path, "/reservations");
  assert.equal(JSON.parse(h.calls[0].options.body).equipmentId, "scope");
  assert.match(h.node("#modal-title").textContent, /设备/);
  h.context.setReservationKind("room"); h.context.setModal(true);
  await h.node("#reservation-form").submit({ preventDefault() {}, submitter: {}, target: h.node("#reservation-form") });
  assert.equal(h.calls[1].path, "/room-reservations");
});

for (const [selector, modal, success] of [
  ["#procurement-form", "ProcurementModal", /采购记录已保存/],
  ["#maintenance-form", "MaintenanceModal", /维修保养记录已保存/],
  ["#equipment-form", "EquipmentModal", /设备已保存/],
  ["#reservation-form", "Modal", /预约已成功提交/],
  ["#meeting-room-form", "MeetingRoomModal", /会议室已创建/],
  ["#member-form", "MemberModal", /账号 .*已创建/],
  ["#edit-member-form", "EditMemberModal", /成员账号 .*已更新/],
  ["#edit-equipment-form", "EditEquipmentModal", /设备信息已更新/]
]) test(`${selector}: committed save closes form before failed follow-up refresh`, async () => {
  const h = harness(); h.run(handlerSource(selector));
  const submitter = { isConnected: true };
  await h.node(selector).submit({ preventDefault() {}, submitter, target: h.node(selector) });
  assert.ok(h.closed.includes(modal), "the committed form is no longer available for resubmit");
  assert.equal(h.calls.filter(call => call.options?.method === "POST" || call.options?.method === "PATCH").length, 1);
  assert.ok(h.toasts.some(toast => success.test(toast.message) && /刷新失败/.test(toast.message)), JSON.stringify(h.toasts));
  assert.equal(submitter.disabled, false);
});

test("password reset exposes the committed temporary password despite refresh failure, without another reset", async () => {
  const h = harness(); h.run(handlerSource("#reset-password-form"));
  const event = { preventDefault() {}, submitter: {} };
  await h.node("#reset-password-form").submit(event);
  assert.equal(h.node("#temporary-password-value").textContent, "reset-secret");
  assert.equal(h.node("#temporary-password").hidden, false);
  await h.node("#reset-password-form").submit(event);
  assert.equal(h.calls.filter(call => call.options?.method === "POST").length, 1);
});

function authHarness(storage, failures = { logout: true }, overrides = {}) {
  const h = harness({
    localStorage: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key) },
    apiRequest: async (path) => {
      h.calls.push({ path });
      if (path === "/auth/logout" && failures.logout) throw new Error("HTTP 503");
      if (path === "/auth/session") return { id: "still-valid", role: "member" };
      return {};
    },
    enterApplication: async () => { h.context.entered = true; },
    ...overrides
  });
  for (const name of ["readPendingLogout", "setPendingLogout", "showLogin", "logout", "initializeApp"]) h.run(functionSource(name));
  h.context.logoutPending = h.context.readPendingLogout();
  return h;
}

test("HTTP logout failure persists locked intent across reload, then clears only after server success", async () => {
  const storage = new Map(), failures = { logout: true };
  const first = authHarness(storage, failures);
  assert.equal(await first.context.logout(), false);
  assert.equal(first.context.currentUser, null);
  assert.match(first.node("#login-error").textContent, /退出尚未完成/);
  assert.equal(first.node("#logout-retry").hidden, false);
  assert.equal(first.node("#login-username").disabled, true);
  const reloaded = authHarness(storage, failures);
  await reloaded.context.initializeApp();
  assert.equal(reloaded.context.entered, undefined);
  assert.equal(reloaded.calls.some(call => call.path === "/auth/session"), false);
  failures.logout = false;
  assert.equal(await reloaded.context.logout(), true);
  assert.equal(storage.size, 0);
  assert.equal(reloaded.node("#logout-retry").hidden, true);
  assert.equal(reloaded.node("#login-username").disabled, false);
});

test("stale session response cannot reopen the app after logout", async () => {
  let resolveSession;
  const storage = new Map();
  const h = authHarness(storage, { logout: false }, { apiRequest: path => path === "/auth/session" ? new Promise(resolve => { resolveSession = resolve; }) : Promise.resolve({}) });
  const starting = h.context.initializeApp();
  await h.context.logout();
  resolveSession({ id: "old-session", role: "member" });
  await starting;
  assert.equal(h.context.entered, undefined);
  assert.equal(h.context.currentUser, null);
});

for (const [name, collection, label] of [
  ["updateMaintenanceRecordStatus", "maintenanceRecords", "maintenanceRecordId"],
  ["updateProcurementRecordStatus", "procurementRecords", "procurementRecordId"]
]) test(`${name}: audit refresh failure never rolls back the committed selector`, async () => {
  const h = harness({ maintenanceStatusLabel: status => status, procurementStatusLabel: status => status });
  h.context[collection] = [{ id: "record", status: "open" }];
  h.run(functionSource(name));
  const select = { value: "completed", dataset: { [label]: "record" } };
  await h.context[name](select);
  assert.equal(select.value, "completed");
  assert.ok(h.toasts.some(toast => /已更新.*刷新失败/.test(toast.message)));
});

test("laboratory save closes before derived-data refresh failure", async () => {
  const h = harness({ loadApplicationData: async () => { throw new Error("unavailable"); } });
  h.run(handlerSource("#laboratory-form"));
  await h.node("#laboratory-form").submit({ preventDefault() {}, submitter: {} });
  assert.ok(h.closed.includes("LaboratoryModal"));
  assert.ok(h.toasts.some(toast => /实验室已创建.*刷新失败/.test(toast.message)));
});

test("first password change hides and clears committed credentials before failed app loading", async () => {
  const h = harness({ enterApplication: async () => { throw new Error("unavailable"); }, showLogin: message => h.toasts.push({ message }) });
  h.run(handlerSource("#password-change-form"));
  await h.node("#password-change-form").submit({ preventDefault() {}, submitter: {} });
  assert.equal(h.context.passwordChangeScreen.hidden, true);
  assert.equal(h.node("#password-change-form").resetCount, 1);
  assert.ok(h.toasts.some(toast => /密码已更新.*刷新失败/.test(toast.message)));
});

test("pending logout blocks login until server confirms logout", async () => {
  const storage = new Map([["lab-resource-logout-pending", "1"]]);
  const h = authHarness(storage);
  h.run(handlerSource("#login-form"));
  await h.node("#login-form").submit({ preventDefault() {}, submitter: {} });
  assert.deepEqual(h.calls.map(call => call.path), ["/auth/logout"]);
  assert.equal(h.context.entered, undefined);
});

test("stale initial data load cannot reenter after a completed logout", async () => {
  let finishLoading;
  const h = authHarness(new Map(), { logout: false }, { loadApplicationData: () => new Promise(resolve => { finishLoading = resolve; }) });
  h.run(functionSource("enterApplication"));
  const opening = h.context.enterApplication();
  await h.context.logout();
  finishLoading();
  await opening;
  assert.equal(h.context.authScreen.hidden, false);
});

for (const tagName of ["v1.4.13", "1.4.13"]) test(`manual upgrade works without a current Git checkout (${tagName})`, () => {
  const h = harness({ updateInfo: { updateAvailable: true, latestVersion: "1.4.13", tagName }, updateStatus: null });
  h.run(functionSource("renderUpdateCenter")); h.context.renderUpdateCenter();
  const command = h.node("#update-manual-command").textContent;
  assert.ok(command.startsWith(`VERSION=${tagName}\n`));
  assert.match(command, /curl -fL --retry 3/);
  assert.match(command, /&&\nsudo bash/); // A failed fetch must not execute an old temp script.
  assert.doesNotMatch(command, /git (?:fetch|show)|cd \/opt/);
  assert.equal(h.node("#update-manual-copy").disabled, false);
});

test("manual upgrade command rejects mismatched or shell-bearing tags", () => {
  for (const tagName of ["v1.4.12", "v1.4.13; echo unexpected"]) {
    const h = harness({ updateInfo: { updateAvailable: true, latestVersion: "1.4.13", tagName }, updateStatus: null });
    h.run(functionSource("renderUpdateCenter")); h.context.renderUpdateCenter();
    assert.equal(h.node("#update-manual-copy").disabled, true);
    assert.doesNotMatch(h.node("#update-manual-command").textContent, /VERSION=/);
  }
});

for (const path of ["/auth/login", "/auth/change-password"]) test(`logout waits for late ${path} Set-Cookie before revoking the session`, async () => {
  let completeAuth, sessionCookie = null;
  const events = [];
  const h = authHarness(new Map(), { logout: false }, {
    performApiRequest: async (requestPath) => {
      if (requestPath === path) {
        await new Promise(resolve => { completeAuth = resolve; });
        sessionCookie = "late-new-session";
        events.push("Set-Cookie");
        return { id: "user", role: "member" };
      }
      assert.equal(requestPath, "/auth/logout");
      events.push("logout"); sessionCookie = null;
      return {};
    }
  });
  h.run(functionSource("apiRequest"));
  const inFlight = h.context.apiRequest(path, { method: "POST" });
  const loggingOut = h.context.logout();
  assert.equal(h.context.logoutPending, true);
  assert.deepEqual(events, []);
  await assert.rejects(h.context.apiRequest("/auth/login", { method: "POST" }), /先完成退出/);
  completeAuth();
  await inFlight; await loggingOut;
  assert.deepEqual(events, ["Set-Cookie", "logout"]);
  assert.equal(sessionCookie, null, "reload has no late authenticated cookie to restore");
  assert.equal(h.context.logoutPending, false);
});

test("cancelled reservation stays cancelled in My Reservations when refresh fails", async () => {
  const h = harness({
    CSS: { escape: value => value },
    myReservations: [{ id: "saved", kind: "equipment", status: "approved" }],
    reservations: [{ id: "saved", status: "approved" }],
    apiRequest: async () => ({ id: "saved", status: "cancelled" })
  });
  h.run(functionSource("myReservationType")); h.run(functionSource("cancelReservation"));
  await h.context.cancelReservation("saved");
  assert.equal(h.context.myReservations[0].status, "cancelled");
  assert.ok(h.toasts.some(toast => /预约已取消.*刷新失败/.test(toast.message)));
});

test("equipment status success remains reflected despite failed audit refresh", async () => {
  const h = harness({ equipment: [{ id: "saved" }], statusLabels: { completed: "完成" } });
  h.run(handlerSource("#equipment-status-form"));
  await h.node("#equipment-status-form").submit({ preventDefault() {}, submitter: { isConnected: true } });
  assert.equal(h.context.drawerEquipment.status, "completed");
  assert.ok(h.toasts.some(toast => /设备状态已更新.*刷新失败/.test(toast.message)));
});

test("equipment deletion removes local records even when audit refresh fails", async () => {
  const h = harness({
    equipment: [{ id: "scope" }], reservations: [{ equipmentId: "scope" }], myReservations: [{ equipmentId: "scope" }],
    selectedCalendarResourceKey: "equipment:scope"
  });
  h.run(handlerSource("#remove-equipment", "click"));
  await h.node("#remove-equipment").click();
  assert.equal(h.context.equipment.length, 0);
  assert.equal(h.context.myReservations.length, 0);
  assert.equal(h.context.drawerEquipment, null);
  assert.ok(h.toasts.some(toast => /设备已从台账移除.*刷新失败/.test(toast.message)));
});

test("a rejected business write remains editable and is not described as saved", async () => {
  const h = harness({ apiRequest: async () => { throw new Error("write rejected"); } });
  h.run(handlerSource("#procurement-form"));
  const submitter = {};
  await h.node("#procurement-form").submit({ preventDefault() {}, submitter });
  assert.equal(h.closed.length, 0);
  assert.equal(submitter.disabled, false);
  assert.equal(h.toasts[0].message, "write rejected");
  assert.doesNotMatch(h.toasts[0].message, /已保存/);
});
