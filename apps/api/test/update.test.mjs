import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { compareVersions, createUpdateManager, normalizeVersion } from "../lib/update.mjs";

function fakeFetch(payload, status = 200) {
  return async () => ({ ok: status >= 200 && status < 300, status, async json() { return payload; } });
}

test("normalizes and compares stable semantic versions", () => {
  assert.equal(normalizeVersion("v1.4.0"), "1.4.0");
  assert.equal(compareVersions("1.4.0", "1.3.1") > 0, true);
  assert.equal(compareVersions("1.3.1", "1.3.1"), 0);
  assert.throws(() => normalizeVersion("latest"));
});

test("checks the latest release without trusting arbitrary repository input", async () => {
  const manager = createUpdateManager({ currentVersion: "1.3.1", repository: "example/project", fetchImpl: fakeFetch({ tag_name: "v1.4.0", name: "v1.4.0", body: "新增升级中心", html_url: "https://example.test/release" }) });
  const result = await manager.check();
  assert.equal(result.latestVersion, "1.4.0");
  assert.equal(result.updateAvailable, true);
  assert.equal(result.repository, "example/project");
  assert.equal(result.releaseNotes, "新增升级中心");
});

test("queues only the checked latest version and persists a status request", async () => {
  const directory = mkdtempSync(join(tmpdir(), "labequip-update-test-"));
  try {
    const manager = createUpdateManager({ currentVersion: "1.3.1", repository: "example/project", requestFile: join(directory, "request.json"), statusFile: join(directory, "status.json"), fetchImpl: fakeFetch({ tag_name: "v1.4.0", name: "v1.4.0" }) });
    const result = await manager.requestUpgrade("1.4.0", { id: "dev", username: "developer", displayName: "开发者" });
    assert.equal(result.state, "queued");
    assert.equal(result.targetVersion, "1.4.0");
    assert.match(readFileSync(join(directory, "status.json"), "utf8"), /queued/);
    assert.equal(JSON.parse(readFileSync(join(directory, "request.json"), "utf8")).actor.username, "developer");
    await assert.rejects(manager.requestUpgrade("1.4.0", { id: "dev" }), /已有升级任务正在执行/);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
