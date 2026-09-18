import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const app = readFileSync(new URL("../app.js", import.meta.url), "utf8");
const css = readFileSync(new URL("../styles.css", import.meta.url), "utf8");

test("my reservations is available to every role and has lifecycle filters", () => {
  assert.match(html, /data-view="my-reservations"[^>]*>[^<]*<span class="nav-icon">[^<]*<\/span>我的预约/);
  assert.match(html, /id="my-reservations-view"/);
  ["all", "approved", "in_use", "completed", "cancelled"].forEach((status) => {
    assert.match(html, new RegExp(`data-my-reservation-filter="${status}"`));
  });
  ["developer", "admin", "member"].forEach((role) => {
    assert.match(app, new RegExp(`${role}:\\s*\\{[^}]*views:\\s*\\[[^\\]]*"my-reservations"`));
  });
  assert.match(app, /apiRequest\("\/my-reservations"\)/);
  assert.match(app, /function renderMyReservations\(\)/);
  assert.match(app, /data-my-reservation-calendar/);
});

test("audit view uses the actual server role instead of developer simulation", () => {
  assert.match(html, /data-view="audit"[^>]*>[^<]*<span class="nav-icon">[^<]*<\/span>操作审计/);
  assert.match(html, /id="audit-view"/);
  assert.match(app, /actualRole === "developer" \|\| actualRole === "admin"/);
  assert.match(app, /apiRequest\(`\/audit-logs\?\$\{auditSearchParams\(\)\}`\)/);
  assert.match(app, /function renderAuditLogs\(\)/);
  assert.match(app, /actorDisplayName/);
  assert.match(app, /entityType/);
});

test("v1.3 meeting-room management is manager-only and supports editing", () => {
  assert.match(html, /id="open-room-form"/);
  assert.match(html, /id="meeting-room-modal"/);
  assert.match(html, /id="meeting-room-active"/);
  assert.match(app, /function setMeetingRoomModal\(open, room = null\)/);
  assert.ok(app.includes('editingMeetingRoom ? `/meeting-rooms/${encodeURIComponent(editingMeetingRoom.id)}` : "/meeting-rooms"'));
  assert.match(app, /document\.querySelectorAll\("\.manager-only"\)/);
  assert.match(app, /const manager = \["developer", "admin"\]\.includes\(currentRole\)/);
  assert.ok(app.includes("renderUpcoming();\n  renderMeetingRooms();\n  updateRoleGuide();"));
  assert.match(app, /room-edit-action/);
});

test("v1.3 audit view filters pages and exports CSV", () => {
  assert.match(html, /id="audit-filter-form"/);
  assert.match(html, /id="audit-pagination"/);
  assert.match(html, /id="audit-export"/);
  assert.match(app, /let auditPagination =/);
  assert.match(app, /function auditSearchParams/);
  assert.match(app, /audit-logs\.csv/);
  assert.match(app, /const summaryText = auditSummaryText\(item\.summary\);/);
  assert.doesNotMatch(app, /auditSummaryText\(item\.summary\) \?[^\n]*auditSummaryText\(item\.summary\)/);
  assert.match(css, /\.audit-toolbar/);
  assert.match(css, /\.list-pagination/);
});

test("audit summaries expose useful business context in Chinese", () => {
  assert.match(app, /status_update:\s*"更新状态"/);
  assert.match(app, /summary\.equipmentId/);
  assert.match(app, /summary\.meetingRoomId/);
  assert.match(app, /summary\.date/);
  assert.match(app, /summary\.start/);
  assert.match(app, /summary\.end/);
  assert.match(app, /summary\.beforeStatus/);
  assert.match(app, /summary\.afterStatus/);
  assert.match(app, /summary\.deleted/);
});

test("reservation changes refresh the new server-backed views", () => {
  assert.match(app, /async function refreshReservationViews\(\)/);
  assert.match(app, /await refreshReservationViews\(\);/);
  assert.match(app, /renderMyReservations\(\);/);
  assert.match(app, /renderAuditLogs\(\);/);
});

test("new operational views have responsive list styling", () => {
  assert.match(css, /\.my-reservations-list\s*\{/);
  assert.match(css, /\.audit-log-list\s*\{/);
  assert.match(css, /@media \(max-width: 760px\)[\s\S]*\.my-reservation-row/);
});

test("mobile calendar keeps empty week days compact and the guide reflects delivered features", () => {
  assert.match(css, /@media \(max-width: 760px\)[\s\S]*\.calendar-overview-empty\s*\{\s*min-height:\s*48px;/);
  assert.doesNotMatch(html, /月视图和外部日历同步尚待实现/);
  assert.doesNotMatch(html, /审计日志、自动备份和正式生产数据库尚未完成/);
});

test("laboratory management is manager-only and the public shell has no visible legacy branding", () => {
  assert.match(html, /id="open-laboratory-form"/);
  assert.match(html, /id="laboratory-modal"/);
  assert.match(html, /id="laboratory-form"/);
  assert.match(app, /function setLaboratoryModal\(open, laboratory = null\)/);
  assert.match(app, /editingLaboratory \? `\/laboratories\//);
  assert.match(app, /data-laboratory-id/);
  assert.match(app, /const canManageLaboratories = \["developer", "admin"\]\.includes\(currentRole\)/);
  assert.doesNotMatch(html, /CIPC|cipc/i);
});

test("laboratory saves reload derived data and retain legacy equipment assignments", () => {
  assert.match(app, /await loadApplicationData\(\);[\s\S]*const refreshedUser = users\.find/);
  assert.match(app, /实验室已保存，关联数据刷新失败/);
  assert.match(app, /if \(open && user\) \{\s*renderLaboratoryOptions\(\);/);
  assert.match(app, /if \(open && item\) \{\s*renderLaboratoryOptions\(\);/);
  assert.match(app, /保留当前归属/);
  assert.match(app, /\.\.\.\(document\.querySelector\("#edit-equipment-laboratory"\)\.value \?/);
  assert.doesNotMatch(html, /id="edit-equipment-laboratory" required/);
});
