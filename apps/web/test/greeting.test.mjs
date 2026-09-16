import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const app = readFileSync(new URL("../app.js", import.meta.url), "utf8");

function loadGreetingForHour() {
  const source = app.match(/function greetingForHour\(hour\) \{[\s\S]*?\n\}/)?.[0];
  assert.ok(source, "greetingForHour must be declared as a testable pure function");
  return Function(`"use strict"; ${source}; return greetingForHour;`)();
}

test("selects a local greeting for every time period", () => {
  const greetingForHour = loadGreetingForHour();
  const cases = [
    [0, "夜深了"],
    [4, "夜深了"],
    [5, "早上好"],
    [10, "早上好"],
    [11, "中午好"],
    [13, "中午好"],
    [14, "下午好"],
    [17, "下午好"],
    [18, "晚上好"],
    [23, "晚上好"],
  ];
  cases.forEach(([hour, expected]) => assert.equal(greetingForHour(hour), expected, `${hour}:00 should display ${expected}`));
});

test("updates the authenticated greeting and schedules the next boundary", () => {
  assert.doesNotMatch(html, /id="page-title">早上好/);
  assert.match(app, /function updatePageGreeting\(date = new Date\(\)\)/);
  assert.match(app, /greetingForHour\(date\.getHours\(\)\)/);
  assert.match(app, /function scheduleGreetingRefresh\(\)/);
  assert.match(app, /nextGreetingBoundary\(now\)/);
  assert.match(app, /scheduleGreetingRefresh\(\);/);
});
