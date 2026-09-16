import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const app = readFileSync(new URL("../app.js", import.meta.url), "utf8");

test("preserves API error details for destructive-action confirmation", () => {
  assert.match(app, /error\.details\s*=\s*payload\.error\?\.details/);
});

test("force deletion uses the authenticated role and clears related local records", () => {
  assert.match(app, /\["admin",\s*"developer"\]\.includes\(currentUser\?\.role\)/);
  assert.match(app, /\/equipment\/\$\{encodeURIComponent\(item\.id\)\}\?force=true/);
  assert.match(app, /JSON\.stringify\(\{\s*expectedHistory:\s*history\s*\}\)/);
  assert.match(app, /reservations\s*=\s*reservations\.filter\(\(entry\)\s*=>\s*entry\.equipmentId\s*!==\s*item\.id\)/);
  assert.match(app, /maintenanceRecords\s*=\s*maintenanceRecords\.filter\(\(entry\)\s*=>\s*entry\.equipmentId\s*!==\s*item\.id\)/);
  assert.match(app, /procurementRecords\s*=\s*procurementRecords\.filter\(\(entry\)\s*=>\s*entry\.equipmentId\s*!==\s*item\.id\)/);
});

test("role-specific guides explain the destructive administrator capability", () => {
  assert.match(app, /developer:\s*`[^`]*强制删除/);
  assert.match(app, /admin:\s*`[^`]*强制删除/);
});
