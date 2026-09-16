import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const css = readFileSync(new URL("../styles.css", import.meta.url), "utf8");
const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const app = readFileSync(new URL("../app.js", import.meta.url), "utf8");

function colorVariables() {
  const root = css.match(/:root\s*\{([\s\S]*?)\}/)?.[1] || "";
  return Object.fromEntries([...root.matchAll(/(--[\w-]+):\s*(#[\da-f]{6})/gi)].map((match) => [match[1], match[2]]));
}

function luminance(hex) {
  const channels = [1, 3, 5]
    .map((index) => Number.parseInt(hex.slice(index, index + 2), 16) / 255)
    .map((channel) => channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4);
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

function contrast(left, right) {
  const leftLuminance = luminance(left);
  const rightLuminance = luminance(right);
  return (Math.max(leftLuminance, rightLuminance) + 0.05) / (Math.min(leftLuminance, rightLuminance) + 0.05);
}

test("interactive colors meet their minimum contrast ratios", () => {
  const colors = colorVariables();
  const pairs = [
    ["--orange-action", "#ffffff", 4.5],
    ["--orange-action-hover", "#ffffff", 4.5],
    ["--green-ink", colors["--green-light"], 4.5],
    ["--blue-ink", colors["--blue-light"], 4.5],
    ["--red-ink", colors["--red-light"], 4.5],
    ["--placeholder-ink", "#ffffff", 4.5],
    ["--control-muted-ink", "#ffffff", 3]
  ];

  for (const [foregroundName, background, minimum] of pairs) {
    assert.ok(colors[foregroundName], `${foregroundName} must be defined`);
    assert.ok(background, `background for ${foregroundName} must be defined`);
    assert.ok(contrast(colors[foregroundName], background) >= minimum, `${foregroundName} must reach ${minimum}:1 contrast`);
  }
});

test("keyboard users receive focus and selected-state semantics", () => {
  assert.match(html, /<a class="skip-link" href="#main-content">跳至主内容<\/a>/);
  assert.match(html, /<main class="main-content" id="main-content" tabindex="-1">/);
  assert.doesNotMatch(html, /role="(?:listbox|option)"/);
  assert.doesNotMatch(html, /aria-haspopup="listbox"/);

  const roleButtons = [...html.matchAll(/<button[^>]+data-role-option="[^"]+"[^>]*>/g)].map((match) => match[0]);
  assert.equal(roleButtons.length, 3);
  roleButtons.forEach((button) => assert.match(button, /aria-pressed="(?:true|false)"/));

  const filterButtons = [...html.matchAll(/<button[^>]+data-(?:filter|calendar-resource-filter)="[^"]+"[^>]*>/g)].map((match) => match[0]);
  assert.ok(filterButtons.length >= 6);
  filterButtons.forEach((button) => assert.match(button, /aria-pressed="(?:true|false)"/));

  assert.match(css, /\.search-box:focus-within\s*\{/);
  assert.match(css, /\.skip-link:focus-visible\s*\{/);
  assert.match(app, /setAttribute\("aria-pressed", String\(active\)\)/);
});

test("authenticated users can change passwords through an accessible dialog", () => {
  assert.match(html, /id="open-password-change"[^>]+aria-label="修改密码"/);
  assert.match(html, /id="self-password-modal"[^>]+aria-hidden="true"[^>]+inert/);
  assert.match(html, /aria-labelledby="self-password-modal-title"/);
  assert.match(html, /id="self-password-form"/);
  assert.match(html, /id="self-current-password"[^>]+autocomplete="current-password"/);
  assert.match(html, /id="self-new-password"[^>]+autocomplete="new-password"/);
  assert.match(html, /id="self-confirm-password"[^>]+autocomplete="new-password"/);
  assert.match(html, /id="self-password-error" role="alert" hidden/);
});

test("dialogs keep keyboard focus inside and restore it when closed", () => {
  const backdrops = [...html.matchAll(/<div class="(?:modal|drawer)-backdrop[^"]*"[^>]*>/g)].map((match) => match[0]);
  assert.ok(backdrops.length >= 9);
  backdrops.forEach((backdrop) => assert.match(backdrop, /aria-hidden="true"[^>]+inert/));
  assert.match(app, /event\.key !== "Tab"/);
  assert.match(app, /event\.shiftKey/);
  assert.match(app, /\.focus\(\)/);
  assert.match(app, /\.inert = !open/);
});

test("reservation time errors are announced beside the form", () => {
  assert.match(html, /id="reservation-time-error" role="alert" hidden/);
  assert.match(app, /reservation-time-error/);
  assert.match(app, /预约结束时间需要晚于开始时间/);
});

test("equipment details can be edited without mixing business fields with status", () => {
  assert.match(html, /id="edit-equipment"[^>]+>编辑信息/);
  assert.match(html, /id="edit-equipment-modal"[^>]+aria-hidden="true"[^>]+inert/);
  assert.match(html, /id="edit-equipment-form"/);
  ["name", "code", "metric", "laboratory", "owner"].forEach((field) => {
    assert.match(html, new RegExp(`id="edit-equipment-${field}"`));
  });
  assert.match(app, /setEditEquipmentModal\(true, (?:drawerEquipment|item)\)/);
  assert.match(app, /apiRequest\(`\/equipment\/\$\{encodeURIComponent\(editingEquipment\.id\)\}`/);
  assert.match(app, /laboratoryId:\s*document\.querySelector\("#edit-equipment-laboratory"\)\.value/);
  assert.match(app, /equipment\[index\] = updated/);
  assert.match(app, /openEquipmentDetail\(updated\.id, equipmentRowAction\(updated\.id\)\)/);
  assert.match(app, /item\.offsetParent !== null/);
});

test("high-frequency searches are debounced and toast errors are assertive", () => {
  assert.match(app, /function debounce\(callback, delay = \d+\)/);
  assert.match(app, /searchInput\.addEventListener\("input", debounce\(renderEquipment\)\)/);
  ["directory-search", "member-search", "calendar-resource-search"].forEach((id) => {
    assert.match(app, new RegExp(`#${id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[^\n]+addEventListener\\(\"input\", debounce`));
  });
  assert.match(app, /function showToast\(message, tone = "success"\)/);
  assert.match(app, /tone === "error" \? "alert" : "status"/);
  assert.match(css, /\.toast\.toast-error\s*\{/);
});

test("API requests use a bounded wait and localized transport errors", () => {
  assert.match(app, /AbortSignal\.timeout\(15_000\)/);
  assert.match(app, /error\?\.name === "TimeoutError"/);
  assert.match(app, /请求超时，请稍后重试/);
  assert.match(app, /网络连接异常，请稍后重试/);
  assert.match(app, /服务器返回异常响应，请稍后重试/);
  assert.doesNotMatch(app, /API response is not JSON/);
});

test("equipment CSV export neutralizes spreadsheet formulas", () => {
  assert.match(app, /\^\[\\t\\r \]\*\[=\+@-\]/);
  assert.match(app, /safe = .*\? `\'\$\{raw\}` : raw/);
});

test("dashboard panels may shrink inside narrow grid tracks", () => {
  assert.match(css, /\.dashboard-grid\s*>\s*\*,\s*\n\.bottom-grid\s*>\s*\*\s*\{\s*min-width:\s*0;/);
});
