const statusClasses = { available: "status-available", maintenance: "status-maintenance", disabled: "status-disabled", retired: "status-retired" };
const statusLabels = { available: "可用", maintenance: "维修中", disabled: "已停用", retired: "已报废" };
const reservationStatusLabels = { approved: "未开始", in_use: "使用中", completed: "已完成", cancelled: "已取消" };
const viewMap = { overview: "overview-view", equipment: "equipment-view", calendar: "calendar-view-page", "my-reservations": "my-reservations-view", "meeting-rooms": "meeting-rooms-view", maintenance: "maintenance-view", records: "records-view", members: "members-view", audit: "audit-view" };
const viewLabels = { overview: "总览", equipment: "设备台账", calendar: "预约日历", "my-reservations": "我的预约", "meeting-rooms": "会议室预约", maintenance: "维修与保养", records: "采购记录", members: "成员与权限", audit: "操作审计" };
const roleDefinitions = {
  developer: { label: "开发者权限", avatar: "D", views: ["overview", "calendar", "my-reservations", "meeting-rooms", "equipment", "maintenance", "records", "members", "audit"], guideSections: ["start", "equipment", "reservation", "records", "access", "faq"] },
  admin: { label: "系统管理员", avatar: "管", views: ["overview", "calendar", "my-reservations", "meeting-rooms", "equipment", "maintenance", "records", "members", "audit"], guideSections: ["start", "equipment", "reservation", "records", "access", "faq"] },
  member: { label: "普通用户", avatar: "用", views: ["overview", "calendar", "my-reservations", "meeting-rooms", "equipment", "maintenance", "records"], guideSections: ["start", "equipment", "reservation", "records", "faq"] }
};
const roleGuideContent = {
  developer: `<p class="guide-eyebrow">DEVELOPER VIEW</p><h3>开发者权限指南</h3><p class="guide-lead">账号身份固定为开发者，可在左下角模拟管理员和普通用户视图，核对导航、业务入口和指南内容。</p><div class="guide-status-list"><div><span class="pill-dot green"></span><strong>完整测试权限</strong><p>可查看全部页面，并保留权限视图切换入口。</p></div><div><span class="pill-dot orange"></span><strong>前端模拟边界</strong><p>角色切换只用于界面验收，不替代正式登录和服务端鉴权。</p></div></div><ol class="guide-steps"><li><span>1</span><div><strong>选择测试角色</strong><p>从左下角切换管理员和普通用户视图。</p></div></li><li><span>2</span><div><strong>核对权限入口</strong><p>确认业务页面、新增设备和成员管理入口符合角色职责。</p></div></li><li><span>3</span><div><strong>验证高风险操作</strong><p>测试含历史设备的强制删除时，必须显示关联记录数量并经过二次确认。</p></div></li></ol><div class="guide-actions"><button class="secondary-button guide-view-link" data-target-view="members" type="button">查看权限页面</button><button class="primary-button guide-view-link" data-target-view="calendar" type="button">检查预约日历 <span>→</span></button></div>`,
  admin: `<p class="guide-eyebrow">ADMIN VIEW</p><h3>系统管理员指南</h3><p class="guide-lead">负责设备台账、实验室记录、维修保养、采购信息和成员账号的整体维护。</p><ol class="guide-steps"><li><span>1</span><div><strong>维护设备台账</strong><p>新增设备，核对资产编号、所在实验室、保管人和共享状态。</p></div></li><li><span>2</span><div><strong>登记业务记录</strong><p>录入维修、保养和采购记录，持续更新处理及验收状态。</p></div></li><li><span>3</span><div><strong>核对成员账号</strong><p>在成员与权限页面检查已创建账号、角色和实验室基础信息。</p></div></li></ol><div class="guide-note warning"><strong>强制删除设备</strong><p>含历史记录的设备仅可在核对预约、维修和采购数量并二次确认后删除；设备及全部关联记录会永久移除。</p></div><div class="guide-actions"><button class="secondary-button guide-view-link" data-target-view="maintenance" type="button">登记维修保养</button><button class="primary-button guide-view-link" data-target-view="members" type="button">查看成员权限 <span>→</span></button></div>`,
  member: `<p class="guide-eyebrow">MEMBER VIEW</p><h3>普通用户指南</h3><p class="guide-lead">可查询和新增设备、预约设备或会议室，并访问维修保养与采购记录。</p><ol class="guide-steps"><li><span>1</span><div><strong>查找或新增设备</strong><p>按设备名称、资产编号、实验室或保管人检索；需要时可新增设备。</p></div></li><li><span>2</span><div><strong>预约资源</strong><p>在统一预约弹窗选择设备或会议室，填写时间、人数和用途。</p></div></li><li><span>3</span><div><strong>查看业务记录</strong><p>从维修与保养、采购记录页面进入对应业务入口。</p></div></li></ol><div class="guide-note"><strong>预约已生效</strong><p>提交成功后预约立即生效，可在总览的今日安排中取消尚未开始的本人预约。</p></div><div class="guide-actions"><button class="secondary-button guide-view-link" data-target-view="meeting-rooms" type="button">预约会议室</button><button class="primary-button guide-view-link" data-target-view="calendar" type="button">查看预约日历 <span>→</span></button></div>`
};
const currentDate = localDate(new Date());

let equipment = [];
let reservations = [];
let meetingRooms = [];
let roomReservations = [];
let maintenanceRecords = [];
let procurementRecords = [];
let laboratories = [];
let users = [];
let myReservations = [];
let auditLogs = [];
let auditPagination = { page: 1, pageSize: 20, total: 0, totalPages: 1 };
let activeMyReservationFilter = "all";
let currentUser = null;
let greetingRefreshTimer = null;
let activeFilter = "all";
let drawerEquipment = null;
let currentRole = "developer";
let displayedWeekStart = startOfWeek(new Date(`${currentDate}T12:00:00`));
let displayedMonth = new Date(new Date(`${currentDate}T12:00:00`).getFullYear(), new Date(`${currentDate}T12:00:00`).getMonth(), 1, 12);
let selectedMonthDate = currentDate;
let reservationKind = "equipment";
let calendarMode = "overview";
let calendarResourceFilter = "all";
let selectedCalendarResourceKey = "";
let expandedCalendarDate = "";

const table = document.querySelector("#equipment-table");
const searchInput = document.querySelector("#equipment-search");
const modal = document.querySelector("#reservation-modal");
const equipmentModal = document.querySelector("#equipment-modal");
const editEquipmentModal = document.querySelector("#edit-equipment-modal");
const maintenanceModal = document.querySelector("#maintenance-modal");
const procurementModal = document.querySelector("#procurement-modal");
const memberModal = document.querySelector("#member-modal");
const editMemberModal = document.querySelector("#edit-member-modal");
const resetPasswordModal = document.querySelector("#reset-password-modal");
const selfPasswordModal = document.querySelector("#self-password-modal");
const meetingRoomModal = document.querySelector("#meeting-room-modal");
const drawer = document.querySelector("#equipment-drawer");
const guideModal = document.querySelector("#guide-modal");
const notificationButton = document.querySelector(".notification-button");
const notificationPanel = document.querySelector("#notification-panel");
const notificationDot = document.querySelector("#notification-dot");
const guideTabs = [...document.querySelectorAll(".guide-tab")];
const roleMenu = document.querySelector("#role-menu");
const roleSwitcher = document.querySelector("#role-switcher-trigger");
const authScreen = document.querySelector("#auth-screen");
const passwordChangeScreen = document.querySelector("#password-change-screen");
let editingUser = null;
let resettingUser = null;
let editingEquipment = null;
let editingMeetingRoom = null;
const dialogReturnFocus = new WeakMap();

notificationButton.addEventListener("click", (event) => {
  event.stopPropagation();
  const open = notificationPanel.hidden;
  notificationPanel.hidden = !open;
  notificationButton.setAttribute("aria-expanded", String(open));
});
document.querySelector(".notification-close").addEventListener("click", (event) => {
  event.stopPropagation();
  notificationPanel.hidden = true;
  notificationButton.setAttribute("aria-expanded", "false");
});
document.addEventListener("click", (event) => {
  if (event.target.closest(".notification-wrap")) return;
  notificationPanel.hidden = true;
  notificationButton.setAttribute("aria-expanded", "false");
});
document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape" || notificationPanel.hidden) return;
  notificationPanel.hidden = true;
  notificationButton.setAttribute("aria-expanded", "false");
  notificationButton.focus();
});

function localDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function greetingForHour(hour) {
  if (hour < 5) return "夜深了";
  if (hour < 11) return "早上好";
  if (hour < 14) return "中午好";
  if (hour < 18) return "下午好";
  return "晚上好";
}

function nextGreetingBoundary(date) {
  const next = new Date(date);
  const boundaryHour = [5, 11, 14, 18, 24].find((hour) => hour > date.getHours());
  if (boundaryHour === 24) {
    next.setDate(next.getDate() + 1);
    next.setHours(0, 0, 0, 0);
  } else {
    next.setHours(boundaryHour, 0, 0, 0);
  }
  return next;
}

function updatePageGreeting(date = new Date()) {
  if (!currentUser) return;
  document.querySelector("#page-title").innerHTML = `${greetingForHour(date.getHours())}，${escapeHtml(currentUser.displayName)} <span>✦</span>`;
}

function stopGreetingRefresh() {
  if (greetingRefreshTimer === null) return;
  window.clearTimeout(greetingRefreshTimer);
  greetingRefreshTimer = null;
}

function scheduleGreetingRefresh() {
  stopGreetingRefresh();
  const now = new Date();
  updatePageGreeting(now);
  const delay = Math.max(1000, nextGreetingBoundary(now).getTime() - now.getTime() + 100);
  greetingRefreshTimer = window.setTimeout(scheduleGreetingRefresh, delay);
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character]);
}

function readStoredRole() {
  try {
    const role = localStorage.getItem("cipc-view-role");
    return roleDefinitions[role] ? role : "developer";
  } catch {
    return "developer";
  }
}

async function apiRequest(path, options = {}) {
  const { signal = AbortSignal.timeout(15_000), headers = {}, ...requestOptions } = options;
  let response;
  try {
    response = await fetch(`/api${path}`, {
      ...requestOptions,
      signal,
      credentials: "same-origin",
      headers: { Accept: "application/json", ...(requestOptions.body ? { "Content-Type": "application/json" } : {}), ...headers }
    });
  } catch (error) {
    if (error?.name === "TimeoutError") throw new Error("请求超时，请稍后重试");
    if (error?.name === "AbortError") throw new Error("请求已取消");
    throw new Error("网络连接异常，请稍后重试");
  }
  const contentType = response.headers.get("content-type") || "";
  if (!contentType.includes("application/json")) throw new Error("服务器返回异常响应，请稍后重试");
  let payload;
  try {
    payload = await response.json();
  } catch {
    throw new Error("服务器返回异常响应，请稍后重试");
  }
  if (!response.ok) {
    const error = new Error(payload.error?.message || "请求处理失败");
    error.code = payload.error?.code;
    error.status = response.status;
    error.details = payload.error?.details;
    throw error;
  }
  return payload.data;
}

function equipmentRow(item, detailed = false) {
  const id = escapeHtml(item.id);
  const name = escapeHtml(item.name);
  const code = escapeHtml(item.code);
  const lab = escapeHtml(item.lab);
  const owner = escapeHtml(item.owner);
  const label = escapeHtml(item.label || statusLabels[item.status]);
  const icon = escapeHtml(item.icon);
  const thumb = escapeHtml(item.thumb);
  const metric = escapeHtml(item.metric);
  const updated = escapeHtml(formatUpdatedAt(item.updatedAt));
  if (detailed) return `<tr data-equipment-id="${id}"><td><div class="equipment-name"><span class="equipment-thumb ${thumb}">${icon}</span><span>${name}<small>${code}</small></span></div></td><td class="metric-cell">${metric}</td><td>${lab}</td><td>${owner}</td><td><span class="status-badge ${statusClasses[item.status]}">${label}</span></td><td class="updated-cell">${updated}</td><td><button class="icon-button row-action directory-row-action" aria-label="查看 ${name}" type="button">•••</button></td></tr>`;
  return `<tr data-equipment-id="${id}"><td><div class="equipment-name"><span class="equipment-thumb ${thumb}">${icon}</span><span>${name}<small>${code}</small></span></div></td><td>${lab}</td><td>${owner}</td><td><span class="status-badge ${statusClasses[item.status]}">${label}</span></td><td><button class="icon-button row-action" aria-label="查看 ${name}" type="button">•••</button></td></tr>`;
}

function renderEquipment() {
  const query = searchInput.value.trim().toLowerCase();
  const filtered = equipment.filter((item) => {
    const matchesFilter = activeFilter === "all" || item.status === activeFilter;
    const matchesQuery = [item.name, item.code, item.lab, item.owner].some((value) => value.toLowerCase().includes(query));
    return matchesFilter && matchesQuery;
  }).slice(0, 4);
  table.innerHTML = filtered.length ? filtered.map((item) => equipmentRow(item)).join("") : `<tr><td colspan="5" class="empty-row">${equipment.length ? "没有找到匹配的设备" : "尚未录入设备"}</td></tr>`;
  document.querySelectorAll("#equipment-table .row-action").forEach((button) => button.addEventListener("click", () => openEquipmentDetail(button.closest("tr").dataset.equipmentId)));
}

function renderDirectory() {
  const filtered = filteredDirectoryEquipment();
  document.querySelector("#equipment-directory").innerHTML = filtered.length ? filtered.map((item) => equipmentRow(item, true)).join("") : `<tr><td colspan="7" class="empty-row">${equipment.length ? "没有找到符合当前条件的设备" : "尚未录入设备"}</td></tr>`;
  document.querySelectorAll(".directory-row-action").forEach((button) => button.addEventListener("click", () => openEquipmentDetail(button.closest("tr").dataset.equipmentId)));
  document.querySelector(".table-pagination > span").textContent = filtered.length
    ? `显示 ${filtered.length} / 共 ${equipment.length} 台设备`
    : `显示 0 / 共 ${equipment.length} 台设备`;
}

function filteredDirectoryEquipment() {
  const query = document.querySelector("#directory-search").value.trim().toLowerCase();
  const laboratory = document.querySelector("#directory-laboratory-filter").value;
  const status = document.querySelector("#directory-status-filter").value;
  const sort = document.querySelector("#directory-sort").value;
  const filtered = equipment.filter((item) => {
    const matchesQuery = [item.name, item.code, item.metric, item.lab, item.owner]
      .some((value) => String(value ?? "").toLowerCase().includes(query));
    const matchesLaboratory = laboratory === "all" || item.lab === laboratory;
    const matchesStatus = status === "all" || item.status === status;
    return matchesQuery && matchesLaboratory && matchesStatus;
  });
  return filtered.sort((left, right) => {
    if (sort === "created-asc") return String(left.createdAt || "").localeCompare(String(right.createdAt || ""));
    if (sort === "name-asc") return left.name.localeCompare(right.name, "zh-CN");
    return String(right.updatedAt || "").localeCompare(String(left.updatedAt || ""));
  });
}

function csvCell(value) {
  const raw = String(value ?? "");
  const safe = /^[\t\r ]*[=+@-]/.test(raw) ? `'${raw}` : raw;
  return `"${safe.replaceAll('"', '""')}"`;
}

function exportEquipmentDirectory() {
  const rows = filteredDirectoryEquipment();
  if (!rows.length) {
    showToast("当前筛选条件下没有可导出的设备");
    return;
  }
  const header = ["设备名称", "资产编号", "性能指标", "所在实验室", "保管人", "状态", "更新时间"];
  const csv = [
    header,
    ...rows.map((item) => [item.name, item.code, item.metric, item.lab, item.owner, item.label || statusLabels[item.status], item.updatedAt || ""])
  ].map((row) => row.map(csvCell).join(",")).join("\r\n");
  const url = URL.createObjectURL(new Blob(["\ufeff", csv], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = `CIPC-设备清单-${currentDate}.csv`;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
  showToast(`已导出 ${rows.length} 台设备`);
}

function renderUpcoming() {
  const now = Date.now();
  const todayReservations = allReservations().filter((item) => item.date === currentDate && !["cancelled", "rejected"].includes(item.status) && reservationEndMs(item) > now);
  document.querySelector("#upcoming-list").innerHTML = todayReservations.length
    ? todayReservations.sort((a, b) => a.start.localeCompare(b.start)).map((item) => `<div class="upcoming-item"><div class="upcoming-time"><strong>${escapeHtml(item.start)}</strong>${escapeHtml(item.end)}</div><div class="upcoming-line"></div><div class="upcoming-info"><strong>${escapeHtml(item.resourceName)}</strong><span>${escapeHtml(item.requesterName)} · ${escapeHtml(item.resourceTypeLabel)} · ${reservationStatusBadge(item.status)}</span></div>${canCancelReservation(item) ? `<button class="text-button cancel-reservation" data-reservation-id="${escapeHtml(item.id)}" data-reservation-type="${item.resourceType}" type="button">取消预约</button>` : ""}</div>`).join("")
    : `<div class="upcoming-empty"><span aria-hidden="true">◷</span><strong>今天暂无预约</strong><small>新预约提交后会显示在这里</small></div>`;
  document.querySelectorAll(".cancel-reservation").forEach((button) => button.addEventListener("click", () => cancelReservation(button.dataset.reservationId, button.dataset.reservationType)));
}

function allReservations() {
  return [
    ...reservations.map((item) => ({ ...item, resourceType: "equipment", resourceTypeLabel: "设备", resourceName: item.equipmentName })),
    ...roomReservations.map((item) => ({ ...item, resourceType: "room", resourceTypeLabel: "会议室", resourceName: item.meetingRoomName }))
  ];
}

function canCancelReservation(reservation) {
  const canManage = currentRole === "developer" || reservation.requesterUserId === currentUser?.id;
  return canManage && reservation.status === "approved" && reservationEndMs(reservation) > Date.now();
}

function reservationStatusBadge(status) {
  return `<em class="reservation-status reservation-${escapeHtml(status)}">${escapeHtml(reservationStatusLabels[status] || status)}</em>`;
}

function reservationEndMs(reservation) {
  const parsed = Date.parse(reservation.endAt || `${reservation.date}T${reservation.end}:00+08:00`);
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatUpdatedAt(value) {
  const timestamp = Date.parse(value || "");
  if (!Number.isFinite(timestamp)) return "时间未知";
  const minutes = Math.max(0, Math.floor((Date.now() - timestamp) / 60000));
  if (minutes < 1) return "刚刚";
  if (minutes < 60) return `${minutes} 分钟前`;
  if (minutes < 1440) return `${Math.floor(minutes / 60)} 小时前`;
  return new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(timestamp));
}

async function cancelReservation(id, type = "equipment") {
  const button = document.querySelector(`[data-reservation-id="${CSS.escape(id)}"]`);
  if (button) button.disabled = true;
  try {
    const path = type === "room" ? `/room-reservations/${encodeURIComponent(id)}/cancel` : `/reservations/${encodeURIComponent(id)}/cancel`;
    const cancelled = await apiRequest(path, { method: "PATCH" });
    const collection = type === "room" ? roomReservations : reservations;
    const index = collection.findIndex((item) => item.id === id);
    if (index >= 0) collection[index] = cancelled;
    renderUpcoming();
    renderFullCalendar();
    renderStats();
    renderNotifications();
    renderMeetingRooms();
    await refreshReservationViews();
    showToast("预约已取消");
  } catch (error) {
    showToast(error.message || "取消预约失败", "error");
  } finally {
    if (button && button.isConnected) button.disabled = false;
  }
}

function myReservationType(item) {
  return item.kind === "room" || item.resourceType === "meeting_room" || item.resourceType === "room" ? "room" : "equipment";
}

function myReservationResourceKey(item) {
  return `${myReservationType(item)}:${item.resourceId}`;
}

function renderMyReservations() {
  const list = document.querySelector("#my-reservations-list");
  const summary = document.querySelector("#my-reservations-summary");
  if (!list || !summary) return;
  const filtered = myReservations
    .filter((item) => activeMyReservationFilter === "all" || item.status === activeMyReservationFilter)
    .sort((left, right) => `${right.date || ""}${right.start || ""}`.localeCompare(`${left.date || ""}${left.start || ""}`));
  summary.textContent = myReservations.length ? `共 ${myReservations.length} 项预约，显示 ${filtered.length} 项` : "当前没有预约记录";
  list.innerHTML = filtered.length
    ? filtered.map((item) => {
      const type = myReservationType(item);
      const typeLabel = type === "room" ? "会议室" : "设备";
      const canCancel = canCancelReservation({ ...item, resourceType: type });
      return `<article class="my-reservation-row"><div class="my-reservation-date"><strong>${escapeHtml(item.date || "日期未知")}</strong><span>${escapeHtml(`${item.start || "--:--"} - ${item.end || "--:--"}`)}</span></div><div class="my-reservation-main"><span class="my-reservation-type">${escapeHtml(typeLabel)}</span><strong>${escapeHtml(item.resourceName || "未命名资源")}</strong><small>${escapeHtml(item.resourceCode || "无编号")} · ${escapeHtml(item.people || 1)} 人 · ${escapeHtml(item.purpose || "未填写用途")}</small></div><div class="my-reservation-status">${reservationStatusBadge(item.status)}</div><div class="my-reservation-actions"><button class="text-button" data-my-reservation-calendar="${escapeHtml(myReservationResourceKey(item))}" data-my-reservation-date="${escapeHtml(item.date || "")}" type="button">查看日历</button>${canCancel ? `<button class="text-button my-reservation-cancel" data-reservation-id="${escapeHtml(item.id)}" data-reservation-type="${escapeHtml(type)}" type="button">取消预约</button>` : ""}</div></article>`;
    }).join("")
    : `<div class="empty-state"><strong>没有匹配的预约</strong><span>调整状态筛选，或从设备、会议室页面创建预约。</span></div>`;
  list.querySelectorAll("[data-my-reservation-calendar]").forEach((button) => button.addEventListener("click", () => {
    selectedCalendarResourceKey = button.dataset.myReservationCalendar;
    if (button.dataset.myReservationDate) displayedWeekStart = startOfWeek(new Date(`${button.dataset.myReservationDate}T12:00:00`));
    expandedCalendarDate = "";
    updateCalendarLabels();
    setCalendarMode("resource");
    document.querySelector('[data-view="calendar"]').click();
  }));
  list.querySelectorAll(".my-reservation-cancel").forEach((button) => button.addEventListener("click", () => cancelReservation(button.dataset.reservationId, button.dataset.reservationType)));
}

function auditActionLabel(action) {
  const labels = { create: "新建", update: "更新", status_update: "更新状态", delete: "删除", force_delete: "强制删除", cancel: "取消预约", password_reset: "重置密码", password_change: "修改密码" };
  const operation = String(action || "").split(".").at(-1);
  return labels[operation] || operation || "操作";
}

function auditEntityLabel(entityType) {
  return { equipment: "设备", user: "成员", reservation: "设备预约", room_reservation: "会议室预约", maintenance_record: "维修保养", procurement_record: "采购记录" }[entityType] || entityType || "业务对象";
}

function auditSummaryText(summary) {
  if (!summary || typeof summary !== "object") return summary ? String(summary) : "";
  const parts = [];
  const equipmentItem = summary.equipmentId ? equipment.find((item) => item.id === summary.equipmentId) : null;
  const roomItem = summary.meetingRoomId ? meetingRooms.find((item) => item.id === summary.meetingRoomId) : null;
  const auditStatuses = { ...statusLabels, ...reservationStatusLabels, open: "待处理", in_progress: "处理中", pending: "待验收", accepted: "已验收", rejected: "验收未通过" };
  const statusText = (status) => auditStatuses[status] || status;
  const fieldLabels = { username: "用户名", displayName: "姓名", role: "权限", laboratoryId: "实验室", name: "名称", code: "编号", metric: "性能指标", lab: "实验室", owner: "保管人", status: "状态" };

  if (summary.name) parts.push(summary.name);
  if (summary.code) parts.push(summary.code);
  if (summary.displayName) parts.push(summary.displayName);
  if (summary.username) parts.push(`@${summary.username}`);
  if (equipmentItem) parts.push(equipmentItem.name);
  else if (summary.equipmentId) parts.push(`设备 ${String(summary.equipmentId).slice(0, 8)}`);
  if (roomItem) parts.push(roomItem.name);
  else if (summary.meetingRoomId) parts.push(`会议室 ${String(summary.meetingRoomId).slice(0, 8)}`);
  if (summary.date) parts.push(summary.date);
  if (summary.start || summary.end) parts.push(`${summary.start || "--:--"}-${summary.end || "--:--"}`);
  if (summary.beforeStatus || summary.afterStatus) parts.push(`${statusText(summary.beforeStatus || "未记录")} → ${statusText(summary.afterStatus || "未记录")}`);
  else if (summary.status) parts.push(statusText(summary.status));
  if (summary.before && summary.after) {
    const changes = Object.keys(summary.after)
      .filter((key) => summary.before[key] !== summary.after[key])
      .map((key) => `${fieldLabels[key] || key}：${statusText(summary.before[key] ?? "未设置")} → ${statusText(summary.after[key] ?? "未设置")}`);
    if (changes.length) parts.push(changes.join("，"));
  }
  if (summary.deleted) {
    parts.push(`删除预约 ${summary.deleted.reservations || 0}、维修保养 ${summary.deleted.maintenance || 0}、采购 ${summary.deleted.procurement || 0}`);
  }
  if (summary.purpose) parts.push(summary.purpose);
  if (summary.vendor) parts.push(summary.vendor);
  return parts.join(" · ");
}

function renderAuditLogs() {
  const list = document.querySelector("#audit-log-list");
  const summary = document.querySelector("#audit-summary");
  if (!list || !summary) return;
  summary.textContent = auditPagination.total ? `共 ${auditPagination.total} 条关键操作记录，当前显示 ${auditLogs.length} 条` : "暂无可显示的操作记录";
  list.innerHTML = auditLogs.length
    ? auditLogs.map((item) => {
      const summaryText = auditSummaryText(item.summary);
      return `<article class="audit-log-row"><div class="audit-log-marker">${escapeHtml(auditActionLabel(item.action).slice(0, 1))}</div><div class="audit-log-main"><strong>${escapeHtml(item.actorDisplayName || "系统成员")} <span>@${escapeHtml(item.actorUsername || "system")}</span></strong><p>${escapeHtml(auditActionLabel(item.action))} · ${escapeHtml(auditEntityLabel(item.entityType))}${summaryText ? ` · ${escapeHtml(summaryText)}` : ""}</p><small>${escapeHtml(formatUpdatedAt(item.createdAt))} · ${escapeHtml(item.entityId || "")}</small></div></article>`;
    }).join("")
    : `<div class="empty-state"><strong>暂无操作审计</strong><span>后续设备、预约、成员和业务记录变更会显示在这里。</span></div>`;
  const pagination = document.querySelector("#audit-pagination");
  if (pagination) {
    pagination.querySelector("span").textContent = `第 ${auditPagination.page} / ${auditPagination.totalPages} 页`;
    document.querySelector("#audit-previous").disabled = auditPagination.page <= 1;
    document.querySelector("#audit-next").disabled = auditPagination.page >= auditPagination.totalPages;
  }
}

function auditSearchParams({ includePage = true } = {}) {
  const params = new URLSearchParams();
  if (includePage) { params.set("page", auditPagination.page); params.set("pageSize", auditPagination.pageSize); }
  const fields = [["q", "#audit-query"], ["entityType", "#audit-entity-type"], ["dateFrom", "#audit-date-from"], ["dateTo", "#audit-date-to"]];
  fields.forEach(([key, selector]) => { const value = document.querySelector(selector)?.value.trim(); if (value) params.set(key, value); });
  return params;
}

async function refreshReservationViews() {
  myReservations = await apiRequest("/my-reservations");
  renderMyReservations();
  await refreshAuditLogs();
}

async function refreshAuditLogs() {
  const actualRole = currentUser?.role;
  if (actualRole === "developer" || actualRole === "admin") {
    const result = await apiRequest(`/audit-logs?${auditSearchParams()}`);
    auditLogs = result.items;
    auditPagination = result.pagination;
    renderAuditLogs();
  }
}

function startOfWeek(date) {
  const result = new Date(date);
  const day = result.getDay() || 7;
  result.setHours(12, 0, 0, 0);
  result.setDate(result.getDate() - day + 1);
  return result;
}

function calendarResources() {
  return [
    ...equipment.map((item) => ({ ...item, key: `equipment:${item.id}`, type: "equipment", typeLabel: "设备" })),
    ...meetingRooms.filter((item) => item.active).map((item) => ({ ...item, key: `room:${item.id}`, type: "room", typeLabel: "会议室", icon: "▣", thumb: "thumb-blue" }))
  ];
}

function calendarReservationKey(item) {
  return item.resourceType === "room" ? `room:${item.meetingRoomId}` : `equipment:${item.equipmentId}`;
}

function weekDates() {
  return Array.from({ length: 7 }, (_, index) => {
    const date = new Date(displayedWeekStart);
    date.setDate(date.getDate() + index);
    return date;
  });
}

function weekReservations() {
  return reservationsForWeek(displayedWeekStart);
}

function monthGridDates() {
  const firstDay = new Date(displayedMonth.getFullYear(), displayedMonth.getMonth(), 1, 12);
  const gridStart = startOfWeek(firstDay);
  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(gridStart);
    date.setDate(date.getDate() + index);
    return date;
  });
}

function monthReservations() {
  const dates = monthGridDates();
  const start = localDate(dates[0]);
  const end = new Date(dates.at(-1));
  end.setDate(end.getDate() + 1);
  const endDate = localDate(end);
  return allReservations()
    .filter((item) => item.date >= start && item.date < endDate && !["cancelled", "rejected"].includes(item.status))
    .sort((left, right) => `${left.date}${left.start}`.localeCompare(`${right.date}${right.start}`));
}

function reservationsForWeek(weekStart) {
  const start = localDate(weekStart);
  const end = new Date(weekStart);
  end.setDate(end.getDate() + 7);
  const endDate = localDate(end);
  return allReservations()
    .filter((item) => item.date >= start && item.date < endDate && !["cancelled", "rejected"].includes(item.status))
    .sort((left, right) => `${left.date}${left.start}`.localeCompare(`${right.date}${right.start}`));
}

function reservationMinutes(item) {
  const [startHour, startMinute] = item.start.split(":").map(Number);
  const [endHour, endMinute] = item.end.split(":").map(Number);
  return Math.max(0, endHour * 60 + endMinute - startHour * 60 - startMinute);
}

function formatReservationHours(minutes) {
  const hours = minutes / 60;
  return `${Number.isInteger(hours) ? hours : hours.toFixed(1)}h`;
}

function resourceUnavailable(resource) {
  return resource?.type === "equipment" && ["maintenance", "disabled", "retired"].includes(resource.status);
}

function setCalendarMode(mode) {
  calendarMode = ["overview", "month", "resource"].includes(mode) ? mode : "overview";
  if (calendarMode === "month") {
    displayedMonth = new Date(displayedWeekStart.getFullYear(), displayedWeekStart.getMonth(), 1, 12);
    const selected = new Date(`${selectedMonthDate}T12:00:00`);
    if (selected.getFullYear() !== displayedMonth.getFullYear() || selected.getMonth() !== displayedMonth.getMonth()) {
      selectedMonthDate = localDate(displayedMonth);
    }
  }
  document.querySelector("#calendar-overview-panel").hidden = calendarMode !== "overview";
  document.querySelector("#calendar-month-panel").hidden = calendarMode !== "month";
  document.querySelector("#calendar-resource-panel").hidden = calendarMode !== "resource";
  document.querySelectorAll("[data-calendar-mode]").forEach((button) => {
    const active = button.dataset.calendarMode === calendarMode;
    button.classList.toggle("active", active);
    button.setAttribute("aria-selected", String(active));
  });
  if (calendarMode === "resource" && !selectedCalendarResourceKey) {
    selectedCalendarResourceKey = calendarResources()[0]?.key || "";
  }
  updateCalendarLabels();
  renderFullCalendar();
  if (calendarMode === "resource") scrollCalendarToToday();
}

function renderMonthCalendar() {
  const dates = monthGridDates();
  const items = monthReservations();
  const currentMonth = displayedMonth.getMonth();
  document.querySelector("#calendar-month-grid").innerHTML = dates.map((date) => {
    const dateValue = localDate(date);
    const dayItems = items.filter((item) => item.date === dateValue);
    const visible = dayItems.slice(0, 3);
    const events = visible.map((item) => `<button class="month-calendar-event ${item.resourceType === "room" ? "room-booking" : "equipment-booking"}" data-month-calendar-resource="${escapeHtml(calendarReservationKey(item))}" data-month-calendar-event-date="${dateValue}" type="button" title="${escapeHtml(`${item.start}-${item.end} ${item.resourceName} · ${item.requesterName}`)}"><time>${escapeHtml(item.start)}</time><span>${escapeHtml(item.resourceName)}</span></button>`).join("");
    const more = dayItems.length > visible.length ? `<button class="month-calendar-more" data-month-calendar-date="${dateValue}" type="button">另有 ${dayItems.length - visible.length} 项</button>` : "";
    const classes = [
      "month-calendar-day",
      date.getMonth() === currentMonth ? "" : "outside-month",
      dateValue === currentDate ? "today" : "",
      dateValue === selectedMonthDate ? "selected" : ""
    ].filter(Boolean).join(" ");
    return `<section class="${classes}" role="gridcell" aria-label="${date.getMonth() + 1}月${date.getDate()}日，${dayItems.length}项预约"><button class="month-day-number" data-month-calendar-date="${dateValue}" type="button" aria-label="查看${date.getMonth() + 1}月${date.getDate()}日预约"><span>${date.getDate()}</span>${dayItems.length ? `<small>${dayItems.length} 项</small>` : ""}</button><div class="month-calendar-events">${events}</div>${more}</section>`;
  }).join("");

  const selectedItems = items.filter((item) => item.date === selectedMonthDate);
  const selectedDate = new Date(`${selectedMonthDate}T12:00:00`);
  document.querySelector("#calendar-month-detail-title").textContent = `${selectedDate.getMonth() + 1} 月 ${selectedDate.getDate()} 日`;
  document.querySelector("#calendar-month-detail-summary").textContent = selectedItems.length ? `共 ${selectedItems.length} 项预约，按开始时间排列` : "当天暂无预约，可直接创建安排";
  const reserveButton = document.querySelector("#calendar-month-reserve");
  reserveButton.disabled = selectedMonthDate < currentDate;
  document.querySelector("#calendar-month-detail-list").innerHTML = selectedItems.length
    ? selectedItems.map((item) => `<button class="month-detail-item" data-month-calendar-resource="${escapeHtml(calendarReservationKey(item))}" data-month-calendar-event-date="${escapeHtml(item.date)}" type="button"><span class="month-detail-time"><strong>${escapeHtml(item.start)}</strong><small>${escapeHtml(item.end)}</small></span><span class="month-detail-content"><span class="month-detail-type ${item.resourceType === "room" ? "room" : "equipment"}">${escapeHtml(item.resourceTypeLabel)}</span><strong>${escapeHtml(item.resourceName)}</strong><small>${escapeHtml(item.requesterName)} · ${escapeHtml(item.people || 1)} 人</small><p>${escapeHtml(item.purpose || "未填写用途")}</p></span><span class="month-detail-status">${reservationStatusBadge(item.status)}<i>查看资源 ›</i></span></button>`).join("")
    : `<div class="month-detail-empty"><span aria-hidden="true">○</span><strong>当天没有安排</strong><small>${selectedMonthDate < currentDate ? "该日期已经结束" : "可使用右上角按钮创建预约"}</small></div>`;
}

function openCalendarReservation(resource, date = currentDate) {
  if (!resource || resourceUnavailable(resource)) return;
  reservationKind = resource.type;
  setModal(true);
  setReservationKind(resource.type);
  const selector = resource.type === "room" ? "#reservation-room" : "#reservation-equipment";
  document.querySelector(selector).value = resource.id;
  document.querySelector("#reservation-date").value = date < currentDate ? currentDate : date;
}

function renderCalendarOverview(items) {
  const dates = weekDates();
  const equipmentTotal = items.filter((item) => item.resourceType === "equipment").length;
  const roomTotal = items.filter((item) => item.resourceType === "room").length;
  document.querySelector("#calendar-week-total").textContent = items.length;
  document.querySelector("#calendar-equipment-total").textContent = equipmentTotal;
  document.querySelector("#calendar-room-total").textContent = roomTotal;
  document.querySelector("#calendar-hours-total").textContent = formatReservationHours(items.reduce((sum, item) => sum + reservationMinutes(item), 0));

  const daily = dates.map((date) => items.filter((item) => item.date === localDate(date)));
  const maxCount = Math.max(1, ...daily.map((itemsForDay) => itemsForDay.length));
  const weekdays = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"];
  document.querySelector("#calendar-overview-grid").innerHTML = dates.map((date, index) => {
    const dateValue = localDate(date);
    const itemsForDay = daily[index];
    const equipmentCount = itemsForDay.filter((item) => item.resourceType === "equipment").length;
    const roomCount = itemsForDay.filter((item) => item.resourceType === "room").length;
    const expanded = expandedCalendarDate === dateValue;
    const visible = expanded ? itemsForDay : itemsForDay.slice(0, 3);
    const entries = visible.length
      ? visible.map((item) => `<button class="calendar-overview-booking ${item.resourceType === "room" ? "room-booking" : "equipment-booking"}" data-calendar-resource-key="${escapeHtml(calendarReservationKey(item))}" type="button"><time>${escapeHtml(item.start)}-${escapeHtml(item.end)}</time><strong>${escapeHtml(item.resourceName)}</strong><small>${escapeHtml(item.requesterName)} · ${escapeHtml(item.resourceTypeLabel)} · ${escapeHtml(reservationStatusLabels[item.status] || item.status)}</small></button>`).join("")
      : `<div class="calendar-overview-empty"><span>暂无预约</span><small>查看单项资源状态</small></div>`;
    const remaining = itemsForDay.length - visible.length;
    const expandButton = itemsForDay.length > 3
      ? `<button class="calendar-day-more" data-calendar-expand-date="${dateValue}" type="button">${expanded ? "收起" : `另有 ${remaining} 项`}</button>`
      : "";
    return `<section class="calendar-overview-day${dateValue === currentDate ? " today" : ""}"><header><span>${weekdays[index]}</span><strong>${date.getMonth() + 1}月${date.getDate()}日</strong><small>${itemsForDay.length} 项预约</small></header><div class="calendar-density-track"><i style="width:${Math.round(itemsForDay.length / maxCount * 100)}%"></i></div><div class="calendar-day-breakdown"><span>设备 ${equipmentCount}</span><span>会议室 ${roomCount}</span></div><div class="calendar-overview-bookings">${entries}</div>${expandButton}</section>`;
  }).join("");
}

function renderCalendarResourcePicker(resources) {
  const query = document.querySelector("#calendar-resource-search").value.trim().toLowerCase();
  const filtered = resources.filter((item) => {
    const matchesType = calendarResourceFilter === "all" || item.type === calendarResourceFilter;
    const matchesQuery = [item.name, item.code, item.lab].some((value) => String(value || "").toLowerCase().includes(query));
    return matchesType && matchesQuery;
  });
  document.querySelector("#calendar-resource-list").innerHTML = filtered.length
    ? filtered.map((item) => `<button class="calendar-resource-item${item.key === selectedCalendarResourceKey ? " active" : ""}" data-calendar-select-resource="${escapeHtml(item.key)}" type="button"><span class="equipment-thumb ${escapeHtml(item.thumb)}">${escapeHtml(item.icon)}</span><span><strong>${escapeHtml(item.name)}</strong><small>${escapeHtml(item.code)} · ${escapeHtml(item.typeLabel)}</small></span><i>›</i></button>`).join("")
    : `<div class="calendar-resource-empty">没有匹配的资源</div>`;
}

function renderResourceCalendar(resources, items) {
  const resource = resources.find((item) => item.key === selectedCalendarResourceKey);
  const reserveButton = document.querySelector("#calendar-resource-reserve");
  if (!resource) {
    document.querySelector("#calendar-selected-name").textContent = "选择资源查看排期";
    document.querySelector("#calendar-selected-meta").textContent = "从左侧列表选择设备或会议室";
    document.querySelector("#calendar-selected-type").textContent = "RESOURCE SCHEDULE";
    document.querySelector("#calendar-selected-icon").textContent = "◇";
    document.querySelector("#calendar-selected-icon").className = "equipment-thumb thumb-orange";
    document.querySelector("#resource-week-grid").innerHTML = `<div class="calendar-empty-state"><strong>尚未选择资源</strong><span>选择设备或会议室后，这里会显示独立周日历。</span></div>`;
    reserveButton.disabled = true;
    return;
  }

  document.querySelector("#calendar-selected-name").textContent = resource.name;
  document.querySelector("#calendar-selected-meta").textContent = resource.type === "room" ? resource.code : `${resource.code} · ${resource.lab}`;
  document.querySelector("#calendar-selected-type").textContent = resource.type === "room" ? "MEETING ROOM SCHEDULE" : "EQUIPMENT SCHEDULE";
  document.querySelector("#calendar-selected-icon").textContent = resource.icon;
  document.querySelector("#calendar-selected-icon").className = `equipment-thumb ${resource.thumb}`;
  reserveButton.disabled = resourceUnavailable(resource);

  const resourceItems = items.filter((item) => calendarReservationKey(item) === resource.key);
  const weekdays = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"];
  document.querySelector("#resource-week-grid").innerHTML = weekDates().map((date, index) => {
    const dateValue = localDate(date);
    const dayItems = resourceItems.filter((item) => item.date === dateValue);
    let body;
    if (dayItems.length) {
      const warning = resourceUnavailable(resource)
        ? `<div class="resource-maintenance-warning"><strong>${escapeHtml(resource.label || statusLabels[resource.status])}</strong><span>${dayItems.length} 项既有预约需要协调</span></div>`
        : "";
      body = `${warning}${dayItems.map((item) => `<article class="resource-booking-block ${resource.type === "room" ? "room-booking" : "equipment-booking"}"><time>${escapeHtml(item.start)}-${escapeHtml(item.end)} ${reservationStatusBadge(item.status)}</time><strong>${escapeHtml(item.requesterName)}</strong><small>${escapeHtml(item.purpose)}</small></article>`).join("")}`;
    } else if (resourceUnavailable(resource)) {
      body = `<div class="resource-day-empty blocked"><strong>暂停预约</strong><span>${escapeHtml(resource.label || statusLabels[resource.status])}</span></div>`;
    } else if (dateValue < currentDate) {
      body = `<div class="resource-day-empty past"><strong>已结束</strong><span>无预约记录</span></div>`;
    } else {
      body = `<button class="resource-day-empty available" data-calendar-book-date="${dateValue}" type="button"><strong>可预约</strong><span>选择此日期</span></button>`;
    }
    return `<section class="resource-week-day${dateValue === currentDate ? " today" : ""}" data-calendar-date="${dateValue}"><header><span>${weekdays[index]}</span><strong>${date.getMonth() + 1}月${date.getDate()}日</strong><small>${dayItems.length ? `${dayItems.length} 项` : "空闲"}</small></header><div class="resource-day-schedule">${body}</div></section>`;
  }).join("");
}

function renderFullCalendar() {
  const resources = calendarResources();
  const items = weekReservations();
  if (selectedCalendarResourceKey && !resources.some((item) => item.key === selectedCalendarResourceKey)) {
    selectedCalendarResourceKey = "";
  }
  if (calendarMode === "resource" && !selectedCalendarResourceKey) {
    selectedCalendarResourceKey = resources[0]?.key || "";
  }
  renderCalendarOverview(items);
  renderMonthCalendar();
  renderCalendarResourcePicker(resources);
  renderResourceCalendar(resources, items);
}

function scrollCalendarToToday() {
  if (calendarMode !== "resource" || window.innerWidth > 760) return;
  window.requestAnimationFrame(() => {
    const scroller = document.querySelector(".resource-week-scroll");
    const today = scroller.querySelector(`[data-calendar-date="${currentDate}"]`);
    scroller.scrollLeft = today ? Math.max(0, today.offsetLeft - 12) : 0;
  });
}

function renderStats() {
  const todayReservations = allReservations().filter((item) => item.date === currentDate && !["cancelled", "rejected"].includes(item.status));
  const activeMaintenance = maintenanceRecords.filter((item) => ["open", "in_progress"].includes(item.status));
  const maintenanceEquipment = equipment.filter((item) => item.status === "maintenance");
  const availableEquipment = equipment.filter((item) => item.status === "available");
  const registeredLabs = new Set(equipment.map((item) => item.lab).filter(Boolean)).size;
  const stats = document.querySelectorAll(".stats-grid .stat-value");
  stats[0].textContent = String(equipment.length).padStart(2, "0");
  stats[1].textContent = String(availableEquipment.length).padStart(2, "0");
  stats[2].textContent = String(todayReservations.length).padStart(2, "0");
  stats[3].textContent = String(maintenanceEquipment.length).padStart(2, "0");
  document.querySelector("#equipment-total-note").textContent = equipment.length ? `覆盖 ${registeredLabs} 个实验室` : "尚未录入设备";
  document.querySelector("#equipment-available-note").textContent = equipment.length ? `${equipment.length - availableEquipment.length} 台当前不可预约` : "尚未录入设备";
  document.querySelector("#today-reservation-note").textContent = todayReservations.length ? `${todayReservations.filter((item) => reservationEndMs(item) > Date.now()).length} 项尚未结束` : "今天暂无预约";
  document.querySelector("#maintenance-equipment-note").textContent = activeMaintenance.length ? `${activeMaintenance.length} 项维修保养待处理` : "暂无待处理事项";
  document.querySelector('[data-view="equipment"] .nav-count').textContent = equipment.length;
  document.querySelector('[data-view="maintenance"] .nav-count').textContent = activeMaintenance.length;
  document.querySelector("#directory-total-count").textContent = equipment.length;
  document.querySelector("#directory-bookable-count").textContent = equipment.filter((item) => !["maintenance", "disabled", "retired"].includes(item.status)).length;
  document.querySelector("#directory-maintenance-count").textContent = maintenanceEquipment.length;
  document.querySelector("#directory-laboratory-count").textContent = registeredLabs;
  renderDashboardSchedule();
  renderAttentionList(activeMaintenance);
  document.querySelector("#dashboard-updated-at").textContent = `数据更新时间：${new Intl.DateTimeFormat("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date())}`;
}

function renderNotifications() {
  const activeMaintenance = maintenanceRecords.filter((item) => ["open", "in_progress"].includes(item.status));
  const todayActiveReservations = allReservations().filter((item) => item.date === currentDate && !["cancelled", "completed"].includes(item.status) && reservationEndMs(item) > Date.now());
  const items = [
    ...(activeMaintenance.length ? [{ title: "维修保养待处理", detail: `${activeMaintenance.length} 条记录需要继续处理`, target: "maintenance" }] : []),
    ...(todayActiveReservations.length ? [{ title: "今日资源安排", detail: `${todayActiveReservations.length} 项预约尚未结束`, target: "overview" }] : [])
  ];
  notificationDot.hidden = items.length === 0;
  document.querySelector("#notification-summary").textContent = items.length ? `当前有 ${items.length} 条需要关注的信息` : "暂无新通知，系统会根据真实业务数据更新这里。";
  document.querySelector("#notification-list").innerHTML = items.map((item) => `<button class="notification-item" data-notification-view="${escapeHtml(item.target)}" type="button"><strong>${escapeHtml(item.title)}</strong><small>${escapeHtml(item.detail)}</small></button>`).join("");
  document.querySelectorAll("[data-notification-view]").forEach((item) => item.addEventListener("click", () => {
    notificationPanel.hidden = true;
    notificationButton.setAttribute("aria-expanded", "false");
    document.querySelector(`[data-view="${item.dataset.notificationView}"]`)?.click();
  }));
}

function renderDashboardSchedule() {
  const items = reservationsForWeek(startOfWeek(new Date(`${currentDate}T12:00:00`)));
  const minutes = items.reduce((sum, item) => sum + reservationMinutes(item), 0);
  document.querySelector("#dashboard-week-count").innerHTML = `<i class="pill-dot orange"></i> 本周 ${items.length} 项预约`;
  document.querySelector("#dashboard-week-hours").textContent = `共 ${formatReservationHours(minutes).replace("h", " 小时")}`;
  document.querySelector("#dashboard-week-track").innerHTML = items.length
    ? `<div class="dashboard-week-list">${items.slice(0, 4).map((item) => `<button class="dashboard-week-booking" data-dashboard-resource-key="${escapeHtml(calendarReservationKey(item))}" type="button"><time>${escapeHtml(item.date.slice(5))} · ${escapeHtml(item.start)}-${escapeHtml(item.end)}</time><strong>${escapeHtml(item.resourceName)}</strong><span>${escapeHtml(item.requesterName)} · ${escapeHtml(item.resourceTypeLabel)}</span></button>`).join("")}${items.length > 4 ? `<button class="dashboard-calendar-more" id="dashboard-calendar-more" type="button">另有 ${items.length - 4} 项，查看完整日历</button>` : ""}</div>`
    : `<div class="calendar-empty-hint">本周暂无预约</div>`;
  document.querySelectorAll("[data-dashboard-resource-key]").forEach((button) => button.addEventListener("click", () => {
    selectedCalendarResourceKey = button.dataset.dashboardResourceKey;
    document.querySelector('[data-view="calendar"]').click();
    setCalendarMode("resource");
  }));
  document.querySelector("#dashboard-calendar-more")?.addEventListener("click", () => document.querySelector('[data-view="calendar"]').click());
}

function renderAttentionList(activeMaintenance) {
  document.querySelector("#attention-count").textContent = activeMaintenance.length;
  document.querySelector("#attention-list").innerHTML = activeMaintenance.length
    ? activeMaintenance.slice(0, 4).map((item) => `<button class="attention-item" data-attention-equipment-id="${escapeHtml(item.equipmentId)}" type="button"><span class="attention-marker"></span><span><strong>${escapeHtml(item.equipmentName)} · ${escapeHtml(item.type === "maintenance" ? "保养" : "维修")}</strong><small>${escapeHtml(maintenanceStatusLabel(item.status))} · ${escapeHtml(item.date)} · ${escapeHtml(item.description)}</small></span><i>›</i></button>`).join("")
    : `<div class="empty-state compact"><strong>暂无业务提醒</strong><span>当前没有待处理的维修或保养事项。</span></div>`;
  document.querySelectorAll("[data-attention-equipment-id]").forEach((button) => button.addEventListener("click", () => openEquipmentDetail(button.dataset.attentionEquipmentId)));
}

function formatCurrency(value) {
  const amount = Number(value);
  return `¥ ${Number.isFinite(amount) ? amount.toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "0.00"}`;
}

function maintenanceStatusLabel(status) {
  return { open: "待处理", in_progress: "处理中", completed: "已完成" }[status] || status;
}

function procurementStatusLabel(status) {
  return { pending: "待验收", accepted: "已验收", rejected: "验收未通过" }[status] || status;
}

function renderMaintenanceRecords() {
  const active = maintenanceRecords.filter((item) => ["open", "in_progress"].includes(item.status));
  const care = maintenanceRecords.filter((item) => item.type === "maintenance");
  const completed = maintenanceRecords.filter((item) => item.status === "completed");
  document.querySelector("#maintenance-open-count").textContent = String(active.length).padStart(2, "0");
  document.querySelector("#maintenance-care-count").textContent = String(care.length).padStart(2, "0");
  document.querySelector("#maintenance-completed-count").textContent = String(completed.length).padStart(2, "0");
  document.querySelector("#maintenance-open-note").textContent = active.length ? "持续跟进" : "暂无待处理";
  document.querySelector("#maintenance-care-note").textContent = care.length ? "已建立记录" : "暂无保养记录";
  document.querySelector("#maintenance-completed-note").textContent = completed.length ? "已完成归档" : "暂无完成记录";
  document.querySelector("#maintenance-list-summary").textContent = maintenanceRecords.length ? `共 ${maintenanceRecords.length} 条记录，按日期倒序显示` : "新增记录后会立即显示在这里";
  document.querySelector("#maintenance-list").innerHTML = maintenanceRecords.length
    ? maintenanceRecords.map((item) => {
      const type = item.type === "maintenance" ? "保养" : "维修";
      const statusClass = item.status === "completed" ? "status-available" : item.status === "in_progress" ? "status-reserved" : "status-maintenance";
      return `<div class="work-order-row"><span class="work-order-icon ${item.type === "maintenance" ? "orange-icon" : "red-icon"}">${item.type === "maintenance" ? "◷" : "⌁"}</span><div class="work-order-main"><strong>${escapeHtml(item.equipmentName)} · ${escapeHtml(type)}</strong><small>${escapeHtml(item.description)} · ${escapeHtml(item.date)} · ${escapeHtml(item.createdByName || "系统成员")}</small></div><span class="record-cost">${escapeHtml(formatCurrency(item.cost))}</span><select class="maintenance-record-status ${statusClass}" data-maintenance-record-id="${escapeHtml(item.id)}" aria-label="修改 ${escapeHtml(item.equipmentName)} 的维修状态"><option value="open"${item.status === "open" ? " selected" : ""}>待处理</option><option value="in_progress"${item.status === "in_progress" ? " selected" : ""}>处理中</option><option value="completed"${item.status === "completed" ? " selected" : ""}>已完成</option></select></div>`;
    }).join("")
    : `<div class="empty-state"><strong>维修保养记录为空</strong><span>点击“新建记录”录入设备维修或保养事项。</span></div>`;
  document.querySelectorAll(".maintenance-record-status").forEach((select) => select.addEventListener("change", () => updateMaintenanceRecordStatus(select)));
}

function applyMaintenanceRecord(record, { prepend = false } = {}) {
  const recordIndex = maintenanceRecords.findIndex((item) => item.id === record.id);
  if (recordIndex >= 0) maintenanceRecords[recordIndex] = record;
  else if (prepend) maintenanceRecords.unshift(record);
  const equipmentIndex = equipment.findIndex((item) => item.id === record.equipmentId);
  if (equipmentIndex >= 0 && record.equipmentStatus) {
    equipment[equipmentIndex] = {
      ...equipment[equipmentIndex],
      status: record.equipmentStatus,
      label: statusLabels[record.equipmentStatus],
      updatedAt: record.updatedAt || new Date().toISOString()
    };
  }
  renderAll();
}

async function updateMaintenanceRecordStatus(select) {
  const previous = maintenanceRecords.find((item) => item.id === select.dataset.maintenanceRecordId)?.status;
  select.disabled = true;
  try {
    const record = await apiRequest(`/maintenance-records/${encodeURIComponent(select.dataset.maintenanceRecordId)}`, {
      method: "PATCH",
      body: JSON.stringify({ status: select.value })
    });
    applyMaintenanceRecord(record);
    await refreshAuditLogs();
    showToast(`维修保养状态已更新为${maintenanceStatusLabel(record.status)}`);
  } catch (error) {
    select.value = previous || "open";
    select.disabled = false;
    showToast(error.message || "维修保养状态更新失败", "error");
  }
}

function renderProcurementRecords() {
  const accepted = procurementRecords.filter((item) => item.status === "accepted");
  const pending = procurementRecords.filter((item) => item.status === "pending");
  const rejected = procurementRecords.filter((item) => item.status === "rejected");
  const total = accepted.reduce((sum, item) => sum + (Number(item.amount) || 0), 0);
  document.querySelector("#procurement-total").textContent = formatCurrency(total);
  document.querySelector("#procurement-summary").textContent = procurementRecords.length ? `共 ${procurementRecords.length} 条：已验收 ${accepted.length}，待验收 ${pending.length}，未通过 ${rejected.length}` : "尚未录入采购与验收数据";
  document.querySelector("#procurement-list").innerHTML = procurementRecords.length
    ? procurementRecords.map((item) => {
      const date = /^\d{4}-(\d{2})-(\d{2})$/.exec(item.date || "");
      const day = date ? date[2] : "--";
      const month = date ? `${Number(date[1])}月` : "日期未知";
      const statusClass = item.status === "accepted" ? "status-available" : item.status === "rejected" ? "status-maintenance" : "status-reserved";
      return `<div class="procurement-row"><div class="procurement-date"><b>${escapeHtml(day)}</b><small>${escapeHtml(month)}</small></div><div><strong>${escapeHtml(item.equipmentName || "未关联设备")}</strong><small>${escapeHtml(item.vendor)} · ${escapeHtml(item.createdByName || "系统成员")}${item.notes ? ` · ${escapeHtml(item.notes)}` : ""}</small></div><span class="price">${escapeHtml(formatCurrency(item.amount))}</span><select class="procurement-record-status ${statusClass}" data-procurement-record-id="${escapeHtml(item.id)}" aria-label="修改 ${escapeHtml(item.equipmentName || "采购记录")} 的验收状态"><option value="pending"${item.status === "pending" ? " selected" : ""}>待验收</option><option value="accepted"${item.status === "accepted" ? " selected" : ""}>已验收</option><option value="rejected"${item.status === "rejected" ? " selected" : ""}>验收未通过</option></select></div>`;
    }).join("")
    : `<div class="empty-state"><strong>采购记录为空</strong><span>点击“新增记录”录入采购信息和初始验收状态。</span></div>`;
  document.querySelectorAll(".procurement-record-status").forEach((select) => select.addEventListener("change", () => updateProcurementRecordStatus(select)));
}

async function updateProcurementRecordStatus(select) {
  const recordIndex = procurementRecords.findIndex((item) => item.id === select.dataset.procurementRecordId);
  const previous = procurementRecords[recordIndex]?.status;
  select.disabled = true;
  try {
    const record = await apiRequest(`/procurement-records/${encodeURIComponent(select.dataset.procurementRecordId)}`, {
      method: "PATCH",
      body: JSON.stringify({ status: select.value })
    });
    if (recordIndex >= 0) procurementRecords[recordIndex] = record;
    renderProcurementRecords();
    if (drawerEquipment?.id === record.equipmentId) renderEquipmentActivity(record.equipmentId);
    await refreshAuditLogs();
    showToast(`采购验收状态已更新为${procurementStatusLabel(record.status)}`);
  } catch (error) {
    select.value = previous || "pending";
    select.disabled = false;
    showToast(error.message || "采购验收状态更新失败", "error");
  }
}

function renderAccessData() {
  const roleLabels = { developer: "开发者", admin: "系统管理员", member: "普通用户" };
  const roleClasses = { developer: "admin-role", admin: "admin-role", member: "user-role" };
  const search = document.querySelector("#member-search")?.value.trim().toLowerCase() || "";
  const filteredUsers = users.filter((user) => [user.displayName, user.username].some((value) => value.toLowerCase().includes(search)));

  document.querySelector("#member-count").textContent = users.length;
  document.querySelector("#member-role-count").textContent = users.filter((user) => user.role === "member").length;
  document.querySelector("#laboratory-count").textContent = laboratories.length;
  document.querySelector("#members-list").innerHTML = filteredUsers.length
    ? filteredUsers.map((user) => {
      const canManage = currentUser?.role === "developer" || user.role !== "developer";
      const canReset = canManage && user.id !== currentUser?.id;
      const actions = canManage
        ? `<div class="member-actions"><button class="member-action-button edit-member-action" data-user-id="${escapeHtml(user.id)}" type="button" title="编辑成员" aria-label="编辑 ${escapeHtml(user.displayName)}">✎</button>${canReset ? `<button class="member-action-button reset-member-action" data-user-id="${escapeHtml(user.id)}" type="button" title="重置密码" aria-label="重置 ${escapeHtml(user.displayName)} 的密码">↻</button>` : ""}</div>`
        : `<span class="member-actions-placeholder" title="开发者账号受保护">受保护</span>`;
      return `<div class="member-row"><div class="avatar avatar-slate">${escapeHtml(user.displayName.slice(0, 1))}</div><div><strong>${escapeHtml(user.displayName)}</strong><small>${escapeHtml(user.username)} · ${escapeHtml(user.laboratoryName || "暂未分配实验室")}</small></div><span class="role-badge ${roleClasses[user.role] || "user-role"}">${escapeHtml(roleLabels[user.role] || user.role)}</span><span class="member-last">${user.mustChangePassword ? "待首次改密" : "已启用"}</span>${actions}</div>`;
    }).join("")
    : `<div class="empty-state compact"><strong>没有匹配账号</strong><span>请调整搜索条件。</span></div>`;
  document.querySelector("#laboratory-list").innerHTML = laboratories.map((laboratory, index) => `<div class="laboratory-row"><span>${String(index + 1).padStart(2, "0")}</span><div><strong>${escapeHtml(laboratory.name)}</strong><small>${escapeHtml(laboratory.alias)} · ${escapeHtml(laboratory.code)}</small></div><i class="pill-dot green"></i></div>`).join("");
}

function renderAll() {
  refreshReservationOptions();
  renderEquipment();
  renderDirectory();
  renderUpcoming();
  renderFullCalendar();
  renderStats();
  renderNotifications();
  renderMeetingRooms();
  renderMaintenanceRecords();
  renderProcurementRecords();
  renderAccessData();
  renderMyReservations();
  renderAuditLogs();
}

function showToast(message, tone = "success") {
  const toast = document.querySelector("#toast");
  document.querySelector("#toast-message").textContent = message;
  document.querySelector(".toast-check").textContent = tone === "error" ? "!" : "✓";
  toast.classList.remove("toast-success", "toast-error");
  toast.classList.add(`toast-${tone}`);
  toast.setAttribute("role", tone === "error" ? "alert" : "status");
  toast.setAttribute("aria-live", tone === "error" ? "assertive" : "polite");
  toast.classList.add("show");
  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(() => toast.classList.remove("show"), 3200);
}

function debounce(callback, delay = 180) {
  let timer;
  return (...args) => {
    window.clearTimeout(timer);
    timer = window.setTimeout(() => callback(...args), delay);
  };
}

function focusableDialogElements(container) {
  return [...container.querySelectorAll('a[href], button, input, select, textarea, [tabindex]:not([tabindex="-1"])')]
    .filter((element) => !element.disabled && !element.hidden && element.getAttribute("aria-hidden") !== "true" && element.offsetParent !== null);
}

function setManagedDialog(container, open, initialFocus = null) {
  const wasOpen = container.classList.contains("open");
  if (open && !wasOpen) dialogReturnFocus.set(container, document.activeElement);
  container.classList.toggle("open", open);
  container.setAttribute("aria-hidden", String(!open));
  container.inert = !open;
  if (open) {
    window.requestAnimationFrame(() => {
      const target = typeof initialFocus === "string" ? container.querySelector(initialFocus) : initialFocus;
      (target || focusableDialogElements(container)[0])?.focus();
    });
  } else if (wasOpen) {
    const returnFocus = dialogReturnFocus.get(container);
    dialogReturnFocus.delete(container);
    if (returnFocus instanceof HTMLElement && document.contains(returnFocus)) returnFocus.focus();
  }
}

function trapDialogFocus(event) {
  if (event.key !== "Tab") return;
  const openDialogs = [...document.querySelectorAll(".modal-backdrop.open, .drawer-backdrop.open")];
  const activeDialog = openDialogs[openDialogs.length - 1];
  if (!activeDialog) return;
  const focusable = focusableDialogElements(activeDialog);
  if (!focusable.length) return;
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  } else if (!activeDialog.contains(document.activeElement)) {
    event.preventDefault();
    first.focus();
  }
}

document.addEventListener("keydown", trapDialogFocus);

function switchView(view) {
  document.querySelectorAll(".workspace-view").forEach((item) => item.classList.remove("active"));
  document.querySelector(`#${viewMap[view] || viewMap.overview}`).classList.add("active");
  window.scrollTo({ top: 0, behavior: "smooth" });
  if (view === "calendar" && calendarMode === "resource") scrollCalendarToToday();
}

function setModal(open) {
  const initialFocus = reservationKind === "room" ? "#reservation-room" : "#reservation-equipment";
  setManagedDialog(modal, open, initialFocus);
  if (open) {
    setAuthError(document.querySelector("#reservation-time-error"));
    setReservationKind(reservationKind);
  }
}

function setReservationKind(kind) {
  const equipmentAvailable = !document.querySelector("#reservation-equipment").disabled;
  const roomAvailable = !document.querySelector("#reservation-room").disabled;
  if (kind === "equipment" && !equipmentAvailable && roomAvailable) kind = "room";
  if (kind === "room" && !roomAvailable && equipmentAvailable) kind = "equipment";
  reservationKind = kind;
  const isRoom = kind === "room";
  document.querySelector("#reservation-equipment-field").hidden = isRoom;
  document.querySelector("#reservation-room-field").hidden = !isRoom;
  document.querySelector("#reservation-equipment").required = !isRoom;
  document.querySelector("#reservation-room").required = isRoom;
  document.querySelectorAll("[data-reservation-kind]").forEach((button) => {
    const active = button.dataset.reservationKind === kind;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  });
  document.querySelector("#modal-title").textContent = isRoom ? "新建会议室预约" : "新建设备预约";
  if (isRoom) {
    document.querySelector("#reservation-people").removeAttribute("max");
  } else {
    document.querySelector("#reservation-people").max = "12";
  }
  (isRoom ? document.querySelector("#reservation-room") : document.querySelector("#reservation-equipment")).focus();
}

function setEquipmentModal(open) {
  setManagedDialog(equipmentModal, open, "#new-equipment-name");
}

function setMeetingRoomModal(open, room = null) {
  editingMeetingRoom = open ? room : null;
  const form = document.querySelector("#meeting-room-form");
  const activeField = document.querySelector(".meeting-room-active-field");
  setAuthError(document.querySelector("#meeting-room-error"));
  if (open) {
    document.querySelector("#meeting-room-modal-title").textContent = room ? "编辑会议室" : "新增会议室";
    document.querySelector("#meeting-room-name").value = room?.name || "";
    document.querySelector("#meeting-room-code").value = room?.code || "";
    document.querySelector("#meeting-room-capacity").value = room?.capacity || 12;
    document.querySelector("#meeting-room-location").value = room?.location || "";
    document.querySelector("#meeting-room-active").value = String(room?.active ?? true);
    activeField.hidden = !room;
  } else {
    form.reset();
    activeField.hidden = true;
  }
  setManagedDialog(meetingRoomModal, open, "#meeting-room-name");
}

function setEditEquipmentModal(open, item = null) {
  editingEquipment = open ? item : null;
  setAuthError(document.querySelector("#edit-equipment-error"));
  if (open && item) {
    document.querySelector("#edit-equipment-name").value = item.name;
    document.querySelector("#edit-equipment-code").value = item.code;
    document.querySelector("#edit-equipment-metric").value = item.metric;
    document.querySelector("#edit-equipment-owner").value = item.owner;
    const laboratory = laboratories.find((entry) => entry.name === item.lab);
    document.querySelector("#edit-equipment-laboratory").value = laboratory?.id || "";
  }
  setManagedDialog(editEquipmentModal, open, "#edit-equipment-name");
}

function setMaintenanceModal(open) {
  if (open) {
    document.querySelector("#maintenance-date").value = currentDate;
  } else {
    document.querySelector("#maintenance-form").reset();
  }
  setManagedDialog(maintenanceModal, open, "#maintenance-equipment");
}

function setProcurementModal(open) {
  if (open) {
    document.querySelector("#procurement-date").value = currentDate;
  } else {
    document.querySelector("#procurement-form").reset();
  }
  setManagedDialog(procurementModal, open, "#procurement-equipment");
}

function setMemberModal(open) {
  setAuthError(document.querySelector("#member-form-error"));
  if (!open) document.querySelector("#member-form").reset();
  setManagedDialog(memberModal, open, "#new-member-name");
}

function setEditMemberModal(open, user = null) {
  editingUser = open ? user : null;
  setAuthError(document.querySelector("#edit-member-form-error"));
  if (open && user) {
    document.querySelector("#edit-member-name").value = user.displayName;
    document.querySelector("#edit-member-username").value = user.username;
    const roleSelect = document.querySelector("#edit-member-role");
    roleSelect.value = user.role;
    roleSelect.disabled = user.role === "developer" || user.id === currentUser?.id;
    document.querySelector("#edit-member-laboratory").value = user.laboratoryId || "";
  }
  setManagedDialog(editMemberModal, open, "#edit-member-name");
}

function setResetPasswordModal(open, user = null) {
  resettingUser = open ? user : null;
  setAuthError(document.querySelector("#reset-password-error"));
  document.querySelector("#temporary-password").hidden = true;
  if (open && user) {
    document.querySelector("#reset-member-avatar").textContent = user.displayName.slice(0, 1);
    document.querySelector("#reset-member-name").textContent = user.displayName;
    document.querySelector("#reset-member-username").textContent = user.username;
  }
  setManagedDialog(resetPasswordModal, open, "#reset-password-form button[type=submit]");
}

function setDrawer(open) {
  setManagedDialog(drawer, open, ".close-drawer");
}

function setRoleMenu(open) {
  if (currentUser?.role !== "developer") return;
  roleMenu.hidden = !open;
  roleSwitcher.setAttribute("aria-expanded", String(open));
  roleSwitcher.classList.toggle("open", open);
  if (open) document.querySelector(`[data-role-option="${currentRole}"]`)?.focus();
}

function updateRoleGuide() {
  const role = roleDefinitions[currentRole];
  document.querySelector("#guide-role-tab-label").textContent = `${role.label}指南`;
  document.querySelector("#guide-role-content").innerHTML = roleGuideContent[currentRole];
  document.querySelector(".guide-header > div > p:last-child").textContent = `${role.label} · 设备查询、预约与数据管理说明`;

  guideTabs.forEach((tab) => { tab.hidden = !role.guideSections.includes(tab.dataset.guideSection); });
  guideTabs.filter((tab) => !tab.hidden).forEach((tab, index) => { tab.querySelector("span").textContent = String(index + 1).padStart(2, "0"); });
  document.querySelectorAll(".guide-admin-only").forEach((element) => { element.hidden = !["developer", "admin"].includes(currentRole); });
  document.querySelector("#guide-records-heading").textContent = "维修、保养与采购记录";
  document.querySelector("#guide-records-lead").textContent = "所有成员都可查询并新增维修、保养和采购记录，保存后会立即同步到业务列表。";
  const activeTab = guideTabs.find((tab) => tab.classList.contains("active") && !tab.hidden);
  activateGuideSection(activeTab?.dataset.guideSection || "start");
}

function applyRoleView(role, announce = false) {
  const actualRole = roleDefinitions[currentUser?.role] ? currentUser.role : "member";
  const nextRole = actualRole === "developer" && roleDefinitions[role] ? role : actualRole;
  if (!roleDefinitions[nextRole]) return;
  role = nextRole;
  currentRole = role;
  const definition = roleDefinitions[role];
  document.body.dataset.role = role;
  if (actualRole === "developer") {
    try { localStorage.setItem("cipc-view-role", role); } catch { /* Storage is optional. */ }
  }

  document.querySelector("#role-view-label").textContent = `当前：${definition.label}`;
  document.querySelector("#sidebar-user-name").textContent = currentUser.displayName;
  document.querySelector("#sidebar-user-avatar").textContent = currentUser.displayName.slice(0, 1);
  document.querySelector("#topbar-role-avatar").textContent = definition.avatar;
  updatePageGreeting();
  roleSwitcher.disabled = actualRole !== "developer";
  roleSwitcher.querySelector(".role-switch-chevron").hidden = actualRole !== "developer";
  if (actualRole !== "developer") roleMenu.hidden = true;
  document.querySelectorAll("[data-role-option]").forEach((option) => {
    const active = option.dataset.roleOption === role;
    option.classList.toggle("active", active);
    option.setAttribute("aria-pressed", String(active));
  });

  document.querySelectorAll(".nav-item[data-view]").forEach((button) => { button.hidden = !definition.views.includes(button.dataset.view); });
  document.querySelector(".secondary-nav").hidden = !definition.views.some((view) => ["records", "members"].includes(view));
  const canManageEquipment = ["developer", "admin", "member"].includes(role);
  const canManageMembers = ["developer", "admin"].includes(role);
  document.querySelector("#open-equipment-form").hidden = !canManageEquipment;
  document.querySelector("#open-member-form").hidden = !canManageMembers;
  document.querySelectorAll(".manager-only").forEach((element) => { element.hidden = !canManageMembers; });
  document.querySelector(".directory-actions").hidden = !canManageEquipment;

  const activeView = document.querySelector(".nav-item.active")?.dataset.view;
  if (!definition.views.includes(activeView)) document.querySelector('[data-view="overview"]').click();
  renderUpcoming();
  renderMeetingRooms();
  updateRoleGuide();
  if (announce) showToast(`已切换为${definition.label}模拟视图`);
}

function setGuideModal(open) {
  const wasOpen = guideModal.classList.contains("open");
  if (open && !wasOpen) {
    activateGuideSection("start");
    document.querySelector(".sidebar").classList.remove("mobile-open");
  }
  const activeTab = guideTabs.find((tab) => tab.classList.contains("active"));
  setManagedDialog(guideModal, open, activeTab);
}

function setSelfPasswordModal(open) {
  setAuthError(document.querySelector("#self-password-error"));
  if (!open) document.querySelector("#self-password-form").reset();
  setManagedDialog(selfPasswordModal, open, "#self-current-password");
}

function activateGuideSection(section, focusTab = false) {
  guideTabs.forEach((tab) => {
    const active = tab.dataset.guideSection === section;
    tab.classList.toggle("active", active);
    tab.setAttribute("aria-selected", String(active));
    tab.tabIndex = active ? 0 : -1;
    if (active && focusTab) tab.focus();
  });
  document.querySelectorAll("[data-guide-panel]").forEach((panel) => {
    const active = panel.dataset.guidePanel === section;
    panel.hidden = !active;
    panel.classList.toggle("active", active);
  });
  document.querySelector(".guide-content").scrollTop = 0;
}

function equipmentRowAction(id) {
  const rows = [...document.querySelectorAll("tr[data-equipment-id]")].filter((item) => item.dataset.equipmentId === id);
  const row = rows.find((item) => item.offsetParent !== null) || rows[0];
  return row?.querySelector(".row-action") || null;
}

function openEquipmentDetail(id, returnFocus = null) {
  drawerEquipment = equipment.find((item) => item.id === id);
  if (!drawerEquipment) return;
  document.querySelector("#drawer-equipment-name").textContent = drawerEquipment.name;
  document.querySelector("#drawer-equipment-code").textContent = drawerEquipment.code;
  document.querySelector("#drawer-icon").textContent = drawerEquipment.icon;
  document.querySelector("#drawer-icon").className = `equipment-thumb ${drawerEquipment.thumb}`;
  document.querySelector("#drawer-status").textContent = drawerEquipment.label || statusLabels[drawerEquipment.status];
  document.querySelector("#drawer-status").className = `status-badge ${statusClasses[drawerEquipment.status]}`;
  document.querySelector("#drawer-status-select").value = drawerEquipment.status;
  document.querySelector("#drawer-lab").textContent = drawerEquipment.lab;
  document.querySelector("#drawer-owner").textContent = drawerEquipment.owner;
  document.querySelector("#drawer-metric").textContent = drawerEquipment.metric;
  renderEquipmentActivity(drawerEquipment.id);
  const reserveButton = document.querySelector("#reserve-from-drawer");
  reserveButton.disabled = ["maintenance", "disabled", "retired"].includes(drawerEquipment.status);
  reserveButton.title = reserveButton.disabled ? "当前状态不可预约" : "";
  setDrawer(true);
  if (returnFocus) dialogReturnFocus.set(drawer, returnFocus);
}

function renderEquipmentActivity(equipmentId) {
  const activity = [
    ...reservations.filter((item) => item.equipmentId === equipmentId).map((item) => ({ date: item.date, sort: `${item.date}T${item.start}`, title: `设备预约 · ${item.start}-${item.end} · ${reservationStatusLabels[item.status] || item.status}`, detail: `${item.requesterName} · ${item.purpose}`, tone: "booking" })),
    ...maintenanceRecords.filter((item) => item.equipmentId === equipmentId).map((item) => ({ date: item.date, sort: `${item.date}T23:59`, title: `${item.type === "maintenance" ? "保养" : "维修"} · ${maintenanceStatusLabel(item.status)}`, detail: item.description, tone: "maintenance" })),
    ...procurementRecords.filter((item) => item.equipmentId === equipmentId).map((item) => ({ date: item.date, sort: `${item.date}T22:00`, title: `采购 · ${procurementStatusLabel(item.status)}`, detail: `${item.vendor} · ${formatCurrency(item.amount)}`, tone: "procurement" }))
  ].sort((left, right) => right.sort.localeCompare(left.sort)).slice(0, 5);
  document.querySelector("#drawer-activity-list").innerHTML = activity.length
    ? activity.map((item) => `<div class="drawer-activity-item ${item.tone}"><span></span><div><strong>${escapeHtml(item.title)}</strong><small>${escapeHtml(item.date)} · ${escapeHtml(item.detail)}</small></div></div>`).join("")
    : `<div class="empty-state compact"><strong>暂无动态</strong><span>该设备还没有预约、维修或采购记录。</span></div>`;
}

function refreshReservationOptions() {
  const bookable = equipment.filter((item) => !["maintenance", "disabled", "retired"].includes(item.status));
  const select = document.querySelector("#reservation-equipment");
  select.innerHTML = bookable.length
    ? bookable.map((item) => `<option value="${escapeHtml(item.id)}">${escapeHtml(item.name)}</option>`).join("")
    : `<option value="">暂无可预约设备</option>`;
  select.disabled = !bookable.length;
  const roomSelect = document.querySelector("#reservation-room");
  const activeRooms = meetingRooms.filter((room) => room.active);
  roomSelect.innerHTML = activeRooms.length ? activeRooms.map((room) => `<option value="${escapeHtml(room.id)}">${escapeHtml(room.name)}</option>`).join("") : `<option value="">暂无可预约会议室</option>`;
  roomSelect.disabled = !activeRooms.length;
  document.querySelector('[data-reservation-kind="equipment"]').disabled = !bookable.length;
  document.querySelector('[data-reservation-kind="room"]').disabled = !activeRooms.length;
  document.querySelectorAll("#open-reservation, #calendar-reserve").forEach((button) => { button.disabled = !bookable.length && !activeRooms.length; });
  document.querySelector("#open-room-reservation").disabled = !activeRooms.length;
  const allEquipmentOptions = equipment.length
    ? equipment.map((item) => `<option value="${escapeHtml(item.id)}">${escapeHtml(item.name)} · ${escapeHtml(item.code)}</option>`).join("")
    : `<option value="">请先新增设备</option>`;
  ["#maintenance-equipment", "#procurement-equipment"].forEach((selector) => {
    const recordSelect = document.querySelector(selector);
    recordSelect.innerHTML = allEquipmentOptions;
    recordSelect.disabled = !equipment.length;
  });
  document.querySelector("#open-maintenance-form").disabled = !equipment.length;
  document.querySelector("#open-procurement-form").disabled = !equipment.length;
}

function renderMeetingRooms() {
  const list = document.querySelector("#meeting-room-list");
  list.innerHTML = meetingRooms.length ? meetingRooms.map((room) => {
    const upcoming = roomReservations
      .filter((item) => item.meetingRoomId === room.id && !["cancelled", "completed"].includes(item.status) && reservationEndMs(item) > Date.now())
      .sort((left, right) => `${left.date}${left.start}`.localeCompare(`${right.date}${right.start}`));
    const bookingList = upcoming.length
      ? `<div class="room-booking-list">${upcoming.slice(0, 3).map((item) => `<div class="room-booking-row"><span><strong>${escapeHtml(`${item.date.slice(5).replace("-", "月")}日 · ${item.start}-${item.end}`)}</strong><small>${escapeHtml(item.requesterName)} · ${escapeHtml(item.people)} 人 · ${reservationStatusBadge(item.status)}</small></span>${canCancelReservation(item) ? `<button class="text-button room-cancel-reservation" data-reservation-id="${escapeHtml(item.id)}" type="button">取消预约</button>` : ""}</div>`).join("")}</div>`
      : `<div class="room-booking-empty">暂无近期预约</div>`;
    const manager = ["developer", "admin"].includes(currentRole);
    return `<article class="panel meeting-room-card${room.active ? "" : " inactive"}"><div class="room-card-heading"><span class="equipment-thumb thumb-blue">▣</span><p class="kicker">${escapeHtml(room.code)}</p><h2>${escapeHtml(room.name)}</h2><span class="room-status ${room.active ? "active" : "inactive"}">${room.active ? "开放预约" : "已停用"}</span><small>${escapeHtml(room.location || "位置未填写")} · 可容纳 ${escapeHtml(room.capacity)} 人</small></div>${bookingList}<div class="room-card-footer"><small>当前及未来 ${upcoming.length} 项预约</small><div class="room-card-actions">${manager ? `<button class="text-button room-edit-action" data-room-id="${escapeHtml(room.id)}" type="button">编辑</button>` : ""}<button class="secondary-button room-reserve-action" data-room-id="${escapeHtml(room.id)}" type="button"${room.active ? "" : " disabled"}>预约会议室</button></div></div></article>`;
  }).join("") : `<div class="empty-state"><strong>暂无会议室</strong><span>当前没有可显示的会议室资源。</span></div>`;
  document.querySelectorAll(".room-reserve-action").forEach((button) => button.addEventListener("click", () => {
    document.querySelector("#reservation-room").value = button.dataset.roomId;
    setModal(true);
    setReservationKind("room");
  }));
  document.querySelectorAll(".room-cancel-reservation").forEach((button) => button.addEventListener("click", () => cancelReservation(button.dataset.reservationId, "room")));
  document.querySelectorAll(".room-edit-action").forEach((button) => button.addEventListener("click", () => setMeetingRoomModal(true, meetingRooms.find((room) => room.id === button.dataset.roomId))));
}

function renderLaboratoryOptions() {
  document.querySelector("#new-equipment-lab").innerHTML = laboratories.map((laboratory) => `<option value="${escapeHtml(laboratory.name)}">${escapeHtml(laboratory.name)} - ${escapeHtml(laboratory.alias)}</option>`).join("");
  document.querySelector("#edit-equipment-laboratory").innerHTML = laboratories.map((laboratory) => `<option value="${escapeHtml(laboratory.id)}">${escapeHtml(laboratory.name)} - ${escapeHtml(laboratory.alias)}</option>`).join("");
  document.querySelector("#new-member-laboratory").innerHTML = `<option value="">暂不分配实验室</option>${laboratories.map((laboratory) => `<option value="${escapeHtml(laboratory.id)}">${escapeHtml(laboratory.name)} - ${escapeHtml(laboratory.alias)}</option>`).join("")}`;
  document.querySelector("#edit-member-laboratory").innerHTML = `<option value="">暂不分配实验室</option>${laboratories.map((laboratory) => `<option value="${escapeHtml(laboratory.id)}">${escapeHtml(laboratory.name)} - ${escapeHtml(laboratory.alias)}</option>`).join("")}`;
  const directoryFilter = document.querySelector("#directory-laboratory-filter");
  const selectedLaboratory = directoryFilter.value;
  const laboratoryNames = [...new Set([...laboratories.map((item) => item.name), ...equipment.map((item) => item.lab)].filter(Boolean))];
  directoryFilter.innerHTML = `<option value="all">全部实验室</option>${laboratoryNames.map((name) => `<option value="${escapeHtml(name)}">${escapeHtml(name)}</option>`).join("")}`;
  directoryFilter.value = laboratoryNames.includes(selectedLaboratory) ? selectedLaboratory : "all";
}

function updateDateLabels() {
  const today = new Date(`${currentDate}T12:00:00`);
  const weekdays = ["SUNDAY", "MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY"];
  const months = ["JANUARY", "FEBRUARY", "MARCH", "APRIL", "MAY", "JUNE", "JULY", "AUGUST", "SEPTEMBER", "OCTOBER", "NOVEMBER", "DECEMBER"];
  document.querySelector("#overview-view .page-heading .kicker").textContent = `${weekdays[today.getDay()]} · ${today.getDate()} ${months[today.getMonth()]} ${today.getFullYear()}`;
  document.querySelector("#reservation-date").value = currentDate;
  document.querySelector("#reservation-date").min = currentDate;
  document.querySelector("#maintenance-date").value = currentDate;
  document.querySelector("#procurement-date").value = currentDate;
  document.querySelector(".upcoming-panel .date-badge").textContent = `${String(today.getDate()).padStart(2, "0")} ${months[today.getMonth()].slice(0, 3)}`;
  updateCalendarLabels(months);
}

function updateCalendarLabels(months = ["JANUARY", "FEBRUARY", "MARCH", "APRIL", "MAY", "JUNE", "JULY", "AUGUST", "SEPTEMBER", "OCTOBER", "NOVEMBER", "DECEMBER"]) {
  const weekStart = displayedWeekStart;
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekEnd.getDate() + 6);
  const range = calendarMode === "month"
    ? `${displayedMonth.getFullYear()} 年 ${displayedMonth.getMonth() + 1} 月`
    : `${weekStart.getFullYear()} 年 ${weekStart.getMonth() + 1} 月 ${weekStart.getDate()} 日 - ${weekEnd.getFullYear()} 年 ${weekEnd.getMonth() + 1} 月 ${weekEnd.getDate()} 日`;
  document.querySelector(".calendar-range strong").textContent = range;
  document.querySelector("#calendar-previous-week").setAttribute("aria-label", calendarMode === "month" ? "上一个月" : "上一周");
  document.querySelector("#calendar-next-week").setAttribute("aria-label", calendarMode === "month" ? "下一个月" : "下一周");
  const dashboardWeekStart = startOfWeek(new Date(`${currentDate}T12:00:00`));
  const dashboardWeekEnd = new Date(dashboardWeekStart);
  dashboardWeekEnd.setDate(dashboardWeekEnd.getDate() + 6);
  document.querySelector(".schedule-panel .panel-heading p").textContent = `${dashboardWeekStart.getDate()} ${months[dashboardWeekStart.getMonth()].slice(0, 3)} - ${dashboardWeekEnd.getDate()} ${months[dashboardWeekEnd.getMonth()].slice(0, 3)} ${dashboardWeekEnd.getFullYear()}`;
  const weekdays = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"];
  [".calendar-days span"].forEach((selector) => {
    document.querySelectorAll(selector).forEach((element, index) => {
      const date = new Date(weekStart);
      date.setDate(date.getDate() + index);
      const small = element.querySelector("small");
      element.firstChild.textContent = weekdays[index];
      small.textContent = date.getDate();
      small.classList.toggle("today", localDate(date) === currentDate);
      element.classList.toggle("current", localDate(date) === currentDate);
      element.classList.toggle("selected-day", localDate(date) === currentDate);
    });
  });
}

function setAuthError(element, message = "") {
  element.textContent = message;
  element.hidden = !message;
}

function showLogin(message = "") {
  stopGreetingRefresh();
  currentUser = null;
  document.body.classList.add("auth-pending");
  document.body.classList.remove("authenticated");
  authScreen.hidden = false;
  passwordChangeScreen.hidden = true;
  setAuthError(document.querySelector("#login-error"), message);
  document.querySelector("#login-form").reset();
  window.requestAnimationFrame(() => document.querySelector("#login-username").focus());
}

function showPasswordChange() {
  document.body.classList.add("auth-pending");
  authScreen.hidden = true;
  passwordChangeScreen.hidden = false;
  setAuthError(document.querySelector("#password-change-error"));
  document.querySelector("#password-change-form").reset();
  document.querySelector("#password-change-username").value = currentUser?.username || "";
  window.requestAnimationFrame(() => document.querySelector("#current-password").focus());
}

async function loadApplicationData() {
  const actualRole = currentUser?.role;
  const roomsPath = ["developer", "admin"].includes(actualRole) ? "/meeting-rooms?includeInactive=true" : "/meeting-rooms";
  const requests = [apiRequest("/equipment"), apiRequest("/reservations"), apiRequest("/laboratories"), apiRequest(roomsPath), apiRequest("/room-reservations"), apiRequest("/maintenance-records"), apiRequest("/procurement-records"), apiRequest("/my-reservations")];
  if (actualRole === "developer" || actualRole === "admin") requests.push(apiRequest("/users"), apiRequest(`/audit-logs?page=1&pageSize=${auditPagination.pageSize}`));
  const result = await Promise.all(requests);
  [equipment, reservations, laboratories, meetingRooms, roomReservations, maintenanceRecords, procurementRecords] = result;
  myReservations = result[7] || [];
  users = result[8] || [];
  const auditResult = result[9] || { items: [], pagination: auditPagination };
  auditLogs = auditResult.items || [];
  auditPagination = auditResult.pagination || auditPagination;
  renderLaboratoryOptions();
  renderAll();
}

async function enterApplication() {
  await loadApplicationData();
  authScreen.hidden = true;
  passwordChangeScreen.hidden = true;
  document.body.classList.remove("auth-pending");
  document.body.classList.add("authenticated");
  document.querySelector(".workspace-button > span:first-child").lastChild.textContent = " CIPC 全部实验室";
  applyRoleView(currentUser.role === "developer" ? readStoredRole() : currentUser.role);
  scheduleGreetingRefresh();
}

async function logout() {
  try { await apiRequest("/auth/logout", { method: "POST" }); } catch { /* The local session is cleared by the login screen regardless. */ }
  showLogin();
}

document.querySelectorAll(".equipment-panel .filter-pill[data-filter]").forEach((button) => button.addEventListener("click", () => {
  document.querySelectorAll(".equipment-panel .filter-pill[data-filter]").forEach((item) => {
    const active = item === button;
    item.classList.toggle("active", active);
    item.setAttribute("aria-pressed", String(active));
  });
  activeFilter = button.dataset.filter;
  renderEquipment();
}));
document.querySelectorAll("[data-my-reservation-filter]").forEach((button) => button.addEventListener("click", () => {
  activeMyReservationFilter = button.dataset.myReservationFilter;
  document.querySelectorAll("[data-my-reservation-filter]").forEach((item) => {
    const active = item === button;
    item.classList.toggle("active", active);
    item.setAttribute("aria-pressed", String(active));
  });
  renderMyReservations();
}));
document.querySelector("#my-reservations-refresh").addEventListener("click", async (event) => {
  const button = event.currentTarget;
  button.disabled = true;
  try {
    await refreshReservationViews();
    showToast("我的预约已刷新");
  } catch (error) {
    showToast(error.message || "预约数据刷新失败", "error");
  } finally {
    button.disabled = false;
  }
});
document.querySelector("#audit-refresh").addEventListener("click", async (event) => {
  const button = event.currentTarget;
  button.disabled = true;
  try {
    await refreshAuditLogs();
    showToast("操作审计已刷新");
  } catch (error) {
    showToast(error.message || "操作审计刷新失败", "error");
  } finally {
    button.disabled = false;
  }
});
document.querySelector("#audit-filter-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  auditPagination.page = 1;
  try { await refreshAuditLogs(); } catch (error) { showToast(error.message || "审计筛选失败", "error"); }
});
document.querySelector("#audit-reset").addEventListener("click", async () => {
  document.querySelector("#audit-filter-form").reset();
  auditPagination.page = 1;
  try { await refreshAuditLogs(); } catch (error) { showToast(error.message || "审计重置失败", "error"); }
});
document.querySelector("#audit-previous").addEventListener("click", async () => { auditPagination.page -= 1; await refreshAuditLogs(); });
document.querySelector("#audit-next").addEventListener("click", async () => { auditPagination.page += 1; await refreshAuditLogs(); });
document.querySelector("#audit-export").addEventListener("click", () => {
  const link = document.createElement("a");
  link.href = `/api/audit-logs.csv?${auditSearchParams({ includePage: false })}`;
  link.download = `CIPC-操作审计-${currentDate}.csv`;
  document.body.append(link);
  link.click();
  link.remove();
});
searchInput.addEventListener("input", debounce(renderEquipment));
document.querySelector("#directory-search").addEventListener("input", debounce(renderDirectory));
document.querySelector("#directory-laboratory-filter").addEventListener("change", renderDirectory);
document.querySelector("#directory-status-filter").addEventListener("change", renderDirectory);
document.querySelector("#directory-sort").addEventListener("change", renderDirectory);
document.querySelector("#export-equipment-directory").addEventListener("click", exportEquipmentDirectory);
document.querySelector("#member-search").addEventListener("input", debounce(renderAccessData));
document.querySelectorAll("#open-reservation, #calendar-reserve").forEach((button) => button.addEventListener("click", () => {
  reservationKind = document.querySelector("#reservation-equipment").disabled ? "room" : "equipment";
  setModal(true);
}));
document.querySelector("#open-room-reservation").addEventListener("click", () => { reservationKind = "room"; setModal(true); });
document.querySelector("#open-room-form").addEventListener("click", () => setMeetingRoomModal(true));
document.querySelectorAll(".close-meeting-room-modal").forEach((button) => button.addEventListener("click", () => setMeetingRoomModal(false)));
meetingRoomModal.addEventListener("click", (event) => { if (event.target === meetingRoomModal) setMeetingRoomModal(false); });
document.querySelectorAll("[data-reservation-kind]").forEach((button) => button.addEventListener("click", () => setReservationKind(button.dataset.reservationKind)));
document.querySelectorAll(".close-modal").forEach((button) => button.addEventListener("click", () => setModal(false)));
modal.addEventListener("click", (event) => { if (event.target === modal) setModal(false); });
document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape") return;
  const roleMenuWasOpen = !roleMenu.hidden;
  setModal(false);
  setEquipmentModal(false);
  setMeetingRoomModal(false);
  setEditEquipmentModal(false);
  setMaintenanceModal(false);
  setProcurementModal(false);
  setMemberModal(false);
  setEditMemberModal(false);
  setResetPasswordModal(false);
  setSelfPasswordModal(false);
  setDrawer(false);
  setGuideModal(false);
  setRoleMenu(false);
  if (roleMenuWasOpen) roleSwitcher.focus();
});

function reservationFormInput() {
  return {
    date: document.querySelector("#reservation-date").value,
    start: document.querySelector("#reservation-start").value,
    end: document.querySelector("#reservation-end").value,
    people: Number(document.querySelector("#reservation-people").value),
    purpose: document.querySelector("#reservation-purpose").value.trim()
  };
}

function validateReservationWindow(input) {
  const errorElement = document.querySelector("#reservation-time-error");
  let message = "";
  if (input.start && input.end && input.end <= input.start) {
    message = "预约结束时间需要晚于开始时间";
  } else if (input.date && input.start) {
    const startAt = Date.parse(`${input.date}T${input.start}:00+08:00`);
    if (!Number.isFinite(startAt) || startAt <= Date.now()) message = "预约开始时间需要晚于当前时间";
  }
  setAuthError(errorElement, message);
  ["#reservation-date", "#reservation-start", "#reservation-end"].forEach((selector) => {
    document.querySelector(selector).setAttribute("aria-invalid", String(Boolean(message)));
  });
  return !message;
}

const reservationStartInput = document.querySelector("#reservation-start");
const reservationEndInput = document.querySelector("#reservation-end");
reservationStartInput.addEventListener("input", () => {
  reservationEndInput.min = reservationStartInput.value;
  validateReservationWindow(reservationFormInput());
});
reservationEndInput.addEventListener("input", () => validateReservationWindow(reservationFormInput()));
document.querySelector("#reservation-date").addEventListener("change", () => validateReservationWindow(reservationFormInput()));

document.querySelector("#reservation-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const submit = event.submitter;
  const input = reservationFormInput();
  if (!validateReservationWindow(input)) {
    (input.end <= input.start ? reservationEndInput : reservationStartInput).focus();
    return;
  }
  submit.disabled = true;
  try {
    const isRoom = reservationKind === "room";
    const reservation = await apiRequest(isRoom ? "/room-reservations" : "/reservations", { method: "POST", body: JSON.stringify({ ...input, ...(isRoom ? { meetingRoomId: document.querySelector("#reservation-room").value } : { equipmentId: document.querySelector("#reservation-equipment").value }) }) });
    const collection = isRoom ? roomReservations : reservations;
    collection.push(reservation);
    collection.sort((a, b) => `${a.date}${a.start}`.localeCompare(`${b.date}${b.start}`));
    renderUpcoming();
    renderFullCalendar();
    renderStats();
    renderNotifications();
    renderMeetingRooms();
    await refreshReservationViews();
    setModal(false);
    event.target.reset();
    document.querySelector("#reservation-date").value = currentDate;
    setAuthError(document.querySelector("#reservation-time-error"));
    showToast("预约已成功提交并生效");
  } catch (error) {
    setAuthError(document.querySelector("#reservation-time-error"), error.message || "预约提交失败");
    showToast(error.message || "预约提交失败", "error");
  } finally {
    submit.disabled = false;
  }
});

document.querySelector("#open-equipment-form").addEventListener("click", () => setEquipmentModal(true));
document.querySelectorAll(".close-equipment-modal").forEach((button) => button.addEventListener("click", () => setEquipmentModal(false)));
equipmentModal.addEventListener("click", (event) => { if (event.target === equipmentModal) setEquipmentModal(false); });

document.querySelector("#open-maintenance-form").addEventListener("click", () => setMaintenanceModal(true));
document.querySelectorAll(".close-maintenance-modal").forEach((button) => button.addEventListener("click", () => setMaintenanceModal(false)));
maintenanceModal.addEventListener("click", (event) => { if (event.target === maintenanceModal) setMaintenanceModal(false); });
document.querySelector("#maintenance-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const submit = event.submitter;
  submit.disabled = true;
  try {
    const record = await apiRequest("/maintenance-records", {
      method: "POST",
      body: JSON.stringify({
        equipmentId: document.querySelector("#maintenance-equipment").value,
        type: document.querySelector("#maintenance-type").value,
        status: document.querySelector("#maintenance-status").value,
        date: document.querySelector("#maintenance-date").value,
        cost: Number(document.querySelector("#maintenance-cost").value),
        description: document.querySelector("#maintenance-description").value.trim()
      })
    });
    applyMaintenanceRecord(record, { prepend: true });
    await refreshAuditLogs();
    setMaintenanceModal(false);
    showToast("维修保养记录已保存");
  } catch (error) {
    showToast(error.message || "维修保养记录保存失败", "error");
  } finally {
    submit.disabled = false;
  }
});

document.querySelector("#open-procurement-form").addEventListener("click", () => setProcurementModal(true));
document.querySelectorAll(".close-procurement-modal").forEach((button) => button.addEventListener("click", () => setProcurementModal(false)));
procurementModal.addEventListener("click", (event) => { if (event.target === procurementModal) setProcurementModal(false); });
document.querySelector("#procurement-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const submit = event.submitter;
  submit.disabled = true;
  try {
    const record = await apiRequest("/procurement-records", {
      method: "POST",
      body: JSON.stringify({
        equipmentId: document.querySelector("#procurement-equipment").value,
        vendor: document.querySelector("#procurement-vendor").value.trim(),
        amount: Number(document.querySelector("#procurement-amount").value),
        date: document.querySelector("#procurement-date").value,
        status: document.querySelector("#procurement-status").value,
        notes: document.querySelector("#procurement-notes").value.trim()
      })
    });
    procurementRecords.unshift(record);
    renderProcurementRecords();
    await refreshAuditLogs();
    setProcurementModal(false);
    showToast("采购记录已保存");
  } catch (error) {
    showToast(error.message || "采购记录保存失败", "error");
  } finally {
    submit.disabled = false;
  }
});

document.querySelector("#meeting-room-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const submit = event.submitter;
  const errorElement = document.querySelector("#meeting-room-error");
  submit.disabled = true;
  setAuthError(errorElement);
  try {
    const input = {
      name: document.querySelector("#meeting-room-name").value.trim(),
      code: document.querySelector("#meeting-room-code").value.trim(),
      capacity: Number(document.querySelector("#meeting-room-capacity").value),
      location: document.querySelector("#meeting-room-location").value.trim(),
      ...(editingMeetingRoom ? { active: document.querySelector("#meeting-room-active").value === "true" } : {})
    };
    const room = await apiRequest(editingMeetingRoom ? `/meeting-rooms/${encodeURIComponent(editingMeetingRoom.id)}` : "/meeting-rooms", {
      method: editingMeetingRoom ? "PATCH" : "POST",
      body: JSON.stringify(input)
    });
    const index = meetingRooms.findIndex((item) => item.id === room.id);
    if (index >= 0) meetingRooms[index] = room; else meetingRooms.push(room);
    meetingRooms.sort((left, right) => left.name.localeCompare(right.name, "zh-CN"));
    setMeetingRoomModal(false);
    refreshReservationOptions();
    renderMeetingRooms();
    renderFullCalendar();
    await refreshAuditLogs();
    showToast(index >= 0 ? "会议室信息已更新" : "会议室已创建");
  } catch (error) {
    setAuthError(errorElement, error.message || "会议室保存失败");
  } finally {
    submit.disabled = false;
  }
});

document.querySelector("#equipment-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const submit = event.submitter;
  submit.disabled = true;
  const input = {
    name: document.querySelector("#new-equipment-name").value.trim(),
    code: document.querySelector("#new-equipment-code").value.trim(),
    metric: document.querySelector("#new-equipment-metric").value.trim(),
    lab: document.querySelector("#new-equipment-lab").value,
    location: document.querySelector("#new-equipment-lab").value,
    owner: document.querySelector("#new-equipment-owner").value.trim(),
    status: document.querySelector("#new-equipment-status").value,
    icon: "◇",
    thumb: "thumb-orange"
  };
  try {
    const newEquipment = await apiRequest("/equipment", { method: "POST", body: JSON.stringify(input) });
    equipment.push(newEquipment);
    renderAll();
    await refreshAuditLogs();
    setEquipmentModal(false);
    event.target.reset();
    showToast("设备已保存并加入台账");
  } catch (error) {
    showToast(error.message || "设备保存失败", "error");
  } finally {
    submit.disabled = false;
  }
});

document.querySelectorAll(".close-edit-equipment-modal").forEach((button) => button.addEventListener("click", () => setEditEquipmentModal(false)));
editEquipmentModal.addEventListener("click", (event) => { if (event.target === editEquipmentModal) setEditEquipmentModal(false); });
document.querySelector("#edit-equipment-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!editingEquipment) return;
  const submit = event.submitter;
  const errorElement = document.querySelector("#edit-equipment-error");
  submit.disabled = true;
  setAuthError(errorElement);
  try {
    const updated = await apiRequest(`/equipment/${encodeURIComponent(editingEquipment.id)}`, {
      method: "PATCH",
      body: JSON.stringify({
        name: document.querySelector("#edit-equipment-name").value.trim(),
        code: document.querySelector("#edit-equipment-code").value.trim(),
        metric: document.querySelector("#edit-equipment-metric").value.trim(),
        laboratoryId: document.querySelector("#edit-equipment-laboratory").value,
        owner: document.querySelector("#edit-equipment-owner").value.trim()
      })
    });
    const index = equipment.findIndex((item) => item.id === updated.id);
    if (index >= 0) equipment[index] = updated;
    setEditEquipmentModal(false);
    renderLaboratoryOptions();
    renderAll();
    await refreshAuditLogs();
    openEquipmentDetail(updated.id, equipmentRowAction(updated.id));
    showToast("设备信息已更新");
  } catch (error) {
    setAuthError(errorElement, error.message || "设备信息更新失败");
  } finally {
    if (submit.isConnected) submit.disabled = false;
  }
});

document.querySelector("#open-member-form").addEventListener("click", () => setMemberModal(true));
document.querySelectorAll(".close-member-modal").forEach((button) => button.addEventListener("click", () => setMemberModal(false)));
memberModal.addEventListener("click", (event) => { if (event.target === memberModal) setMemberModal(false); });
document.querySelector("#member-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const submit = event.submitter;
  const errorElement = document.querySelector("#member-form-error");
  submit.disabled = true;
  setAuthError(errorElement);
  try {
    const newUser = await apiRequest("/users", {
      method: "POST",
      body: JSON.stringify({
        displayName: document.querySelector("#new-member-name").value.trim(),
        username: document.querySelector("#new-member-username").value.trim().toLowerCase(),
        role: document.querySelector("#new-member-role").value,
        laboratoryId: document.querySelector("#new-member-laboratory").value || null
      })
    });
    users = await apiRequest("/users");
    renderAccessData();
    await refreshAuditLogs();
    setMemberModal(false);
    showToast(`账号 ${newUser.username} 已创建，初始密码为 123456`);
  } catch (error) {
    setAuthError(errorElement, error.message || "成员账号创建失败");
  } finally {
    submit.disabled = false;
  }
});

document.querySelector("#members-list").addEventListener("click", (event) => {
  const editButton = event.target.closest(".edit-member-action");
  const resetButton = event.target.closest(".reset-member-action");
  const button = editButton || resetButton;
  if (!button) return;
  const user = users.find((item) => item.id === button.dataset.userId);
  if (!user) return;
  if (editButton) setEditMemberModal(true, user);
  else setResetPasswordModal(true, user);
});

document.querySelectorAll(".close-edit-member-modal").forEach((button) => button.addEventListener("click", () => setEditMemberModal(false)));
editMemberModal.addEventListener("click", (event) => { if (event.target === editMemberModal) setEditMemberModal(false); });
document.querySelector("#edit-member-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!editingUser) return;
  const submit = event.submitter;
  const errorElement = document.querySelector("#edit-member-form-error");
  submit.disabled = true;
  setAuthError(errorElement);
  try {
    const updatedUser = await apiRequest(`/users/${encodeURIComponent(editingUser.id)}`, {
      method: "PATCH",
      body: JSON.stringify({
        displayName: document.querySelector("#edit-member-name").value.trim(),
        username: document.querySelector("#edit-member-username").value.trim().toLowerCase(),
        role: document.querySelector("#edit-member-role").value,
        laboratoryId: document.querySelector("#edit-member-laboratory").value || null
      })
    });
    if (updatedUser.id === currentUser.id) currentUser = updatedUser;
    users = await apiRequest("/users");
    renderAccessData();
    setEditMemberModal(false);
    if (updatedUser.id === currentUser.id) applyRoleView(currentUser.role);
    await refreshAuditLogs();
    showToast(`成员账号 ${updatedUser.username} 已更新`);
  } catch (error) {
    setAuthError(errorElement, error.message || "成员账号更新失败");
  } finally {
    submit.disabled = false;
  }
});

document.querySelectorAll(".close-reset-password-modal").forEach((button) => button.addEventListener("click", () => setResetPasswordModal(false)));
resetPasswordModal.addEventListener("click", (event) => { if (event.target === resetPasswordModal) setResetPasswordModal(false); });
document.querySelector("#copy-temporary-password").addEventListener("click", async () => {
  const password = document.querySelector("#temporary-password-value").textContent;
  try {
    await navigator.clipboard.writeText(password);
    showToast("临时密码已复制");
  } catch {
    showToast("临时密码复制失败，请手动复制", "error");
  }
});
document.querySelector("#reset-password-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!resettingUser) return;
  const submit = event.submitter;
  const errorElement = document.querySelector("#reset-password-error");
  submit.disabled = true;
  setAuthError(errorElement);
  try {
    const resetResult = await apiRequest(`/users/${encodeURIComponent(resettingUser.id)}/reset-password`, { method: "POST" });
    users = await apiRequest("/users");
    renderAccessData();
    document.querySelector("#temporary-password-value").textContent = resetResult.temporaryPassword || "未返回临时密码";
    document.querySelector("#temporary-password").hidden = false;
    await refreshAuditLogs();
    showToast(`${(resetResult.user || resetResult).displayName} 的密码已重置`);
  } catch (error) {
    setAuthError(errorElement, error.message || "密码重置失败");
  } finally {
    submit.disabled = false;
  }
});

document.querySelectorAll(".close-drawer").forEach((button) => button.addEventListener("click", () => setDrawer(false)));
drawer.addEventListener("click", (event) => { if (event.target === drawer) setDrawer(false); });
document.querySelector("#edit-equipment").addEventListener("click", () => {
  if (!drawerEquipment) return;
  const item = drawerEquipment;
  setDrawer(false);
  setEditEquipmentModal(true, item);
});
document.querySelector("#reserve-from-drawer").addEventListener("click", () => {
  if (["maintenance", "disabled", "retired"].includes(drawerEquipment.status)) {
    showToast("当前设备不可预约，请联系设备保管人", "error");
    return;
  }
  setDrawer(false);
  setModal(true);
  document.querySelector("#reservation-equipment").value = drawerEquipment.id;
});

document.querySelector("#view-equipment-calendar").addEventListener("click", () => {
  if (!drawerEquipment) return;
  selectedCalendarResourceKey = `equipment:${drawerEquipment.id}`;
  setDrawer(false);
  document.querySelector('[data-view="calendar"]').click();
  setCalendarMode("resource");
});

document.querySelector("#equipment-status-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!drawerEquipment) return;
  const submit = event.submitter;
  const status = document.querySelector("#drawer-status-select").value;
  if (status === drawerEquipment.status) {
    showToast("设备状态没有变化");
    return;
  }
  submit.disabled = true;
  try {
    const updated = await apiRequest(`/equipment/${encodeURIComponent(drawerEquipment.id)}`, {
      method: "PATCH",
      body: JSON.stringify({ status })
    });
    const index = equipment.findIndex((item) => item.id === updated.id);
    if (index >= 0) equipment[index] = updated;
    drawerEquipment = updated;
    renderAll();
    openEquipmentDetail(updated.id, equipmentRowAction(updated.id));
    await refreshAuditLogs();
    const futureReservations = reservations.filter((item) => item.equipmentId === updated.id && ["approved", "in_use"].includes(item.status) && reservationEndMs(item) > Date.now()).length;
    showToast(updated.status === "maintenance" && futureReservations
      ? `设备已设为维修中，另有 ${futureReservations} 项预约需要协调`
      : `设备状态已更新为${updated.label || statusLabels[updated.status]}`);
  } catch (error) {
    showToast(error.message || "设备状态更新失败", "error");
  } finally {
    if (submit.isConnected) submit.disabled = false;
  }
});

document.querySelector("#remove-equipment").addEventListener("click", async () => {
  if (!drawerEquipment) return;
  const item = drawerEquipment;
  if (!window.confirm(`确认移除设备“${item.name}”（${item.code}）？此操作仅适用于尚无预约、维修或采购记录的设备。`)) return;
  const button = document.querySelector("#remove-equipment");
  button.disabled = true;
  try {
    let result;
    try {
      result = await apiRequest(`/equipment/${encodeURIComponent(item.id)}`, { method: "DELETE" });
    } catch (error) {
      const canForceDelete = ["admin", "developer"].includes(currentUser?.role);
      if (error.code !== "EQUIPMENT_HAS_HISTORY" || !canForceDelete) throw error;

      const history = error.details || {};
      const reservationsCount = Number(history.reservations) || 0;
      const maintenanceCount = Number(history.maintenance) || 0;
      const procurementCount = Number(history.procurement) || 0;
      const confirmed = window.confirm(
        `设备“${item.name}”（${item.code}）已有 ${reservationsCount} 条预约、${maintenanceCount} 条维修保养和 ${procurementCount} 条采购记录。\n\n` +
        "以管理员身份强制删除会永久移除设备及以上全部关联记录，且不可恢复。确认继续？"
      );
      if (!confirmed) return;
      result = await apiRequest(`/equipment/${encodeURIComponent(item.id)}?force=true`, {
        method: "DELETE",
        body: JSON.stringify({ expectedHistory: history })
      });
    }

    equipment = equipment.filter((entry) => entry.id !== item.id);
    reservations = reservations.filter((entry) => entry.equipmentId !== item.id);
    maintenanceRecords = maintenanceRecords.filter((entry) => entry.equipmentId !== item.id);
    procurementRecords = procurementRecords.filter((entry) => entry.equipmentId !== item.id);
    if (selectedCalendarResourceKey === `equipment:${item.id}`) selectedCalendarResourceKey = "";
    drawerEquipment = null;
    setDrawer(false);
    renderAll();
    await refreshAuditLogs();
    showToast(result?.forced ? "设备及全部关联记录已强制删除" : "设备已从台账移除");
  } catch (error) {
    showToast(error.message || "设备移除失败", "error");
  } finally {
    button.disabled = false;
  }
});

document.querySelectorAll(".nav-item").forEach((button) => button.addEventListener("click", () => {
  document.querySelectorAll(".nav-item").forEach((item) => item.classList.remove("active"));
  button.classList.add("active");
  document.querySelector("#breadcrumb-current").textContent = viewLabels[button.dataset.view] || "总览";
  switchView(button.dataset.view);
  if (window.innerWidth <= 760) document.querySelector(".sidebar").classList.remove("mobile-open");
}));

document.querySelector(".mobile-menu").addEventListener("click", () => document.querySelector(".sidebar").classList.toggle("mobile-open"));
document.querySelectorAll("#open-calendar, #calendar-view").forEach((button) => button.addEventListener("click", () => document.querySelector('[data-view="calendar"]').click()));
document.querySelector("#calendar-previous-week").addEventListener("click", () => {
  if (calendarMode === "month") {
    displayedMonth = new Date(displayedMonth.getFullYear(), displayedMonth.getMonth() - 1, 1, 12);
    displayedWeekStart = startOfWeek(displayedMonth);
    selectedMonthDate = localDate(displayedMonth);
  } else {
    displayedWeekStart = new Date(displayedWeekStart);
    displayedWeekStart.setDate(displayedWeekStart.getDate() - 7);
  }
  expandedCalendarDate = "";
  updateCalendarLabels();
  renderFullCalendar();
  scrollCalendarToToday();
});
document.querySelector("#calendar-next-week").addEventListener("click", () => {
  if (calendarMode === "month") {
    displayedMonth = new Date(displayedMonth.getFullYear(), displayedMonth.getMonth() + 1, 1, 12);
    displayedWeekStart = startOfWeek(displayedMonth);
    selectedMonthDate = localDate(displayedMonth);
  } else {
    displayedWeekStart = new Date(displayedWeekStart);
    displayedWeekStart.setDate(displayedWeekStart.getDate() + 7);
  }
  expandedCalendarDate = "";
  updateCalendarLabels();
  renderFullCalendar();
  scrollCalendarToToday();
});
document.querySelector("#calendar-today").addEventListener("click", () => {
  displayedWeekStart = startOfWeek(new Date(`${currentDate}T12:00:00`));
  displayedMonth = new Date(new Date(`${currentDate}T12:00:00`).getFullYear(), new Date(`${currentDate}T12:00:00`).getMonth(), 1, 12);
  selectedMonthDate = currentDate;
  expandedCalendarDate = "";
  updateCalendarLabels();
  renderFullCalendar();
  scrollCalendarToToday();
});
document.querySelectorAll("[data-calendar-mode]").forEach((button) => button.addEventListener("click", () => setCalendarMode(button.dataset.calendarMode)));
document.querySelector("#calendar-overview-grid").addEventListener("click", (event) => {
  const expandButton = event.target.closest("[data-calendar-expand-date]");
  if (expandButton) {
    expandedCalendarDate = expandedCalendarDate === expandButton.dataset.calendarExpandDate ? "" : expandButton.dataset.calendarExpandDate;
    renderFullCalendar();
    return;
  }
  const booking = event.target.closest("[data-calendar-resource-key]");
  if (!booking) return;
  selectedCalendarResourceKey = booking.dataset.calendarResourceKey;
  setCalendarMode("resource");
});
function openMonthCalendarResource(resourceKey, date) {
  selectedCalendarResourceKey = resourceKey;
  displayedWeekStart = startOfWeek(new Date(`${date}T12:00:00`));
  setCalendarMode("resource");
}
document.querySelector("#calendar-month-grid").addEventListener("click", (event) => {
  const resource = event.target.closest("[data-month-calendar-resource]");
  if (resource) {
    openMonthCalendarResource(resource.dataset.monthCalendarResource, resource.dataset.monthCalendarEventDate);
    return;
  }
  const date = event.target.closest("[data-month-calendar-date]")?.dataset.monthCalendarDate;
  if (!date) return;
  selectedMonthDate = date;
  renderMonthCalendar();
  if (window.innerWidth <= 760) {
    window.requestAnimationFrame(() => document.querySelector(".month-calendar-detail").scrollIntoView({ behavior: "smooth", block: "start" }));
  }
});
document.querySelector("#calendar-month-detail-list").addEventListener("click", (event) => {
  const resource = event.target.closest("[data-month-calendar-resource]");
  if (resource) openMonthCalendarResource(resource.dataset.monthCalendarResource, resource.dataset.monthCalendarEventDate);
});
document.querySelector("#calendar-month-reserve").addEventListener("click", () => {
  if (selectedMonthDate < currentDate) return;
  setModal(true);
  document.querySelector("#reservation-date").value = selectedMonthDate;
});
document.querySelector("#calendar-resource-search").addEventListener("input", debounce(() => renderCalendarResourcePicker(calendarResources())));
document.querySelectorAll("[data-calendar-resource-filter]").forEach((button) => button.addEventListener("click", () => {
  calendarResourceFilter = button.dataset.calendarResourceFilter;
  document.querySelectorAll("[data-calendar-resource-filter]").forEach((item) => {
    const active = item === button;
    item.classList.toggle("active", active);
    item.setAttribute("aria-pressed", String(active));
  });
  renderCalendarResourcePicker(calendarResources());
}));
document.querySelector("#calendar-resource-list").addEventListener("click", (event) => {
  const button = event.target.closest("[data-calendar-select-resource]");
  if (!button) return;
  selectedCalendarResourceKey = button.dataset.calendarSelectResource;
  renderFullCalendar();
  scrollCalendarToToday();
});
document.querySelector("#resource-week-grid").addEventListener("click", (event) => {
  const button = event.target.closest("[data-calendar-book-date]");
  if (!button) return;
  openCalendarReservation(calendarResources().find((item) => item.key === selectedCalendarResourceKey), button.dataset.calendarBookDate);
});
document.querySelector("#calendar-resource-reserve").addEventListener("click", () => {
  const resource = calendarResources().find((item) => item.key === selectedCalendarResourceKey);
  const weekStartDate = localDate(displayedWeekStart);
  openCalendarReservation(resource, weekStartDate > currentDate ? weekStartDate : currentDate);
});
document.querySelector("#calendar-refresh").addEventListener("click", async (event) => {
  const button = event.currentTarget;
  button.disabled = true;
  try {
    await loadApplicationData();
    showToast("预约数据已刷新");
  } catch (error) {
    showToast(error.message || "预约数据刷新失败", "error");
  } finally {
    button.disabled = false;
  }
});
document.querySelector("#view-all-equipment").addEventListener("click", () => document.querySelector('[data-view="equipment"]').click());
document.querySelectorAll(".demo-action").forEach((button) => button.addEventListener("click", () => showToast(button.dataset.message)));
roleSwitcher.addEventListener("click", () => setRoleMenu(roleMenu.hidden));
document.querySelector("#logout-button").addEventListener("click", logout);
document.querySelector("#password-change-logout").addEventListener("click", logout);
document.querySelector("#open-password-change").addEventListener("click", () => setSelfPasswordModal(true));
document.querySelectorAll(".close-self-password-modal").forEach((button) => button.addEventListener("click", () => setSelfPasswordModal(false)));
selfPasswordModal.addEventListener("click", (event) => { if (event.target === selfPasswordModal) setSelfPasswordModal(false); });
document.querySelectorAll("[data-role-option]").forEach((option) => option.addEventListener("click", () => {
  applyRoleView(option.dataset.roleOption, true);
  setRoleMenu(false);
}));
document.addEventListener("click", (event) => { if (!event.target.closest(".role-switcher")) setRoleMenu(false); });
document.addEventListener("visibilitychange", () => {
  if (!document.hidden && currentUser) scheduleGreetingRefresh();
});
document.querySelector("#open-user-guide").addEventListener("click", () => setGuideModal(true));
document.querySelectorAll(".close-guide-modal").forEach((button) => button.addEventListener("click", () => setGuideModal(false)));
guideModal.addEventListener("click", (event) => { if (event.target === guideModal) setGuideModal(false); });
guideTabs.forEach((tab) => {
  tab.addEventListener("click", () => activateGuideSection(tab.dataset.guideSection));
  tab.addEventListener("keydown", (event) => {
    if (!["ArrowDown", "ArrowUp", "ArrowRight", "ArrowLeft", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const visibleTabs = guideTabs.filter((item) => !item.hidden);
    const index = visibleTabs.indexOf(tab);
    const lastIndex = visibleTabs.length - 1;
    const nextIndex = event.key === "Home" ? 0 : event.key === "End" ? lastIndex : ["ArrowDown", "ArrowRight"].includes(event.key) ? (index + 1) % visibleTabs.length : (index - 1 + visibleTabs.length) % visibleTabs.length;
    activateGuideSection(visibleTabs[nextIndex].dataset.guideSection, true);
  });
});
guideModal.addEventListener("click", (event) => {
  const button = event.target.closest(".guide-view-link");
  if (!button) return;
  setGuideModal(false);
  document.querySelector(`[data-view="${button.dataset.targetView}"]`).click();
});

document.querySelector("#login-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const submit = event.submitter;
  const errorElement = document.querySelector("#login-error");
  submit.disabled = true;
  setAuthError(errorElement);
  try {
    currentUser = await apiRequest("/auth/login", {
      method: "POST",
      body: JSON.stringify({
        username: document.querySelector("#login-username").value.trim(),
        password: document.querySelector("#login-password").value
      })
    });
    if (currentUser.mustChangePassword) showPasswordChange();
    else await enterApplication();
  } catch (error) {
    setAuthError(errorElement, error.status === 502 ? "登录服务暂时不可用" : error.message || "登录失败");
  } finally {
    submit.disabled = false;
  }
});

document.querySelector("#password-change-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const submit = event.submitter;
  const errorElement = document.querySelector("#password-change-error");
  const newPassword = document.querySelector("#new-password").value;
  const confirmPassword = document.querySelector("#confirm-password").value;
  setAuthError(errorElement);
  if (newPassword !== confirmPassword) {
    setAuthError(errorElement, "两次输入的新密码不一致");
    return;
  }
  submit.disabled = true;
  try {
    currentUser = await apiRequest("/auth/change-password", {
      method: "POST",
      body: JSON.stringify({ currentPassword: document.querySelector("#current-password").value, newPassword })
    });
    await enterApplication();
    showToast("密码已更新");
  } catch (error) {
    setAuthError(errorElement, error.message || "密码修改失败");
  } finally {
    submit.disabled = false;
  }
});

document.querySelector("#self-password-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const submit = event.submitter;
  const errorElement = document.querySelector("#self-password-error");
  const newPassword = document.querySelector("#self-new-password").value;
  const confirmPassword = document.querySelector("#self-confirm-password").value;
  setAuthError(errorElement);
  if (newPassword !== confirmPassword) {
    setAuthError(errorElement, "两次输入的新密码不一致");
    document.querySelector("#self-confirm-password").focus();
    return;
  }
  submit.disabled = true;
  try {
    currentUser = await apiRequest("/auth/change-password", {
      method: "POST",
      body: JSON.stringify({ currentPassword: document.querySelector("#self-current-password").value, newPassword })
    });
    setSelfPasswordModal(false);
    showToast("密码已更新，其他登录会话已失效");
  } catch (error) {
    setAuthError(errorElement, error.message || "密码修改失败");
  } finally {
    submit.disabled = false;
  }
});

async function initializeApp() {
  updateDateLabels();
  try {
    localStorage.removeItem("cipc-demo-equipment");
    localStorage.removeItem("cipc-demo-reservations");
  } catch { /* Old demo storage is optional. */ }
  try {
    currentUser = await apiRequest("/auth/session");
    if (currentUser.mustChangePassword) showPasswordChange();
    else await enterApplication();
  } catch (error) {
    showLogin([401, 403].includes(error.status) ? "" : `系统数据加载失败：${error.message || "请稍后重试"}`);
  }
}

initializeApp();
