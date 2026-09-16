import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const app = readFileSync(new URL("../app.js", import.meta.url), "utf8");
const css = readFileSync(new URL("../styles.css", import.meta.url), "utf8");

test("calendar offers overview, month, and resource modes", () => {
  const overview = html.indexOf('data-calendar-mode="overview"');
  const month = html.indexOf('data-calendar-mode="month"');
  const resource = html.indexOf('data-calendar-mode="resource"');
  assert.ok(overview >= 0 && month > overview && resource > month);
  assert.match(html, /id="calendar-month-panel"[^>]+role="tabpanel"/);
  assert.match(html, /id="calendar-month-grid"/);
  assert.match(html, /id="calendar-month-detail-list"/);
  assert.match(app, /let displayedMonth = new Date\(/);
  assert.match(app, /function monthGridDates\(\)/);
  assert.match(app, /Array\.from\(\{ length: 42 \}/);
  assert.match(app, /function renderMonthCalendar\(\)/);
  assert.match(app, /data-month-calendar-date/);
  assert.match(app, /data-month-calendar-resource/);
});

test("sidebar follows workflow order and separates resources from administration", () => {
  const overview = html.indexOf('data-view="overview"');
  const calendar = html.indexOf('data-view="calendar"');
  const mine = html.indexOf('data-view="my-reservations"');
  const rooms = html.indexOf('data-view="meeting-rooms"');
  const equipment = html.indexOf('data-view="equipment"');
  const maintenance = html.indexOf('data-view="maintenance"');
  const records = html.indexOf('data-view="records"');
  const members = html.indexOf('data-view="members"');
  const audit = html.indexOf('data-view="audit"');
  assert.ok(overview < calendar && calendar < mine && mine < rooms);
  assert.ok(rooms < equipment && equipment < maintenance && maintenance < records);
  assert.ok(records < members && members < audit);
  assert.match(html, /<span class="nav-label">资源与业务<\/span>/);
});

test("Chinese typography and dashboard empty state use explicit styles", () => {
  assert.match(css, /--font-sans:\s*"PingFang SC",\s*"Microsoft YaHei",\s*"Noto Sans SC"/);
  assert.match(css, /font-family:\s*var\(--font-sans\)/);
  assert.match(css, /\.upcoming-empty\s*\{/);
  assert.match(css, /\.month-calendar-layout\s*\{/);
  assert.match(css, /@media \(max-width: 760px\)[\s\S]*\.month-calendar-layout/);
  assert.match(app, /class="upcoming-empty"/);
});
