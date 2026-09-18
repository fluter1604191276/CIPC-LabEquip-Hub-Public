import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDatabase } from "../lib/database.mjs";

test("reopening a customized database does not reseed stale laboratories", () => {
  const directory = mkdtempSync(join(tmpdir(), "labequip-laboratory-lifecycle-"));
  const filePath = join(directory, "app.sqlite");

  try {
    const database = createDatabase(filePath);
    const initialCount = database.prepare("SELECT COUNT(*) AS count FROM laboratories").get().count;
    assert.equal(initialCount, 8);

    const existing = database.prepare("SELECT id FROM laboratories ORDER BY sort_order LIMIT 1").get();
    database.prepare(`
      UPDATE laboratories
      SET code = ?, name = ?, alias = ?, updated_at = ?
      WHERE id = ?
    `).run("CUSTOM-01", "自定义实验空间", "新空间", new Date().toISOString(), existing.id);
    database.close();

    const reopened = createDatabase(filePath);
    assert.equal(reopened.prepare("SELECT COUNT(*) AS count FROM laboratories").get().count, initialCount);
    assert.deepEqual(
      { ...reopened.prepare("SELECT code, name, alias FROM laboratories WHERE id = ?").get(existing.id) },
      { code: "CUSTOM-01", name: "自定义实验空间", alias: "新空间" }
    );
    assert.equal(reopened.prepare("SELECT COUNT(*) AS count FROM laboratories WHERE code = ?").get("LAB-01").count, 0);
    reopened.close();
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("an empty database still receives the built-in laboratory seed", () => {
  const database = createDatabase(":memory:");
  assert.equal(database.prepare("SELECT COUNT(*) AS count FROM laboratories").get().count, 8);
  database.close();
});
