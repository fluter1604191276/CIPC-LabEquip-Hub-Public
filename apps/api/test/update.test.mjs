import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { compareVersions, createUpdateManager, normalizeVersion } from "../lib/update.mjs";

const COMMIT_SHA = "0123456789abcdef0123456789abcdef01234567";

function fakeFetch(payload, status = 200) {
  return async () => ({ ok: status >= 200 && status < 300, status, async json() { return payload; } });
}

function queuedFetch(releasePayload, commitPayload = { sha: COMMIT_SHA }) {
  return async (url) => ({
    ok: true,
    status: 200,
    async json() {
      return String(url).endsWith(`/commits/v${releasePayload.tag_name?.replace(/^v/, "")}`) ? commitPayload : releasePayload;
    }
  });
}

test("normalizes and compares stable semantic versions", () => {
  assert.equal(normalizeVersion("v1.4.0"), "1.4.0");
  assert.equal(compareVersions("1.4.0", "1.3.1") > 0, true);
  assert.equal(compareVersions("1.3.1", "1.3.1"), 0);
  assert.throws(() => normalizeVersion("latest"));
});

test("checks the latest release and resolves its immutable commit SHA", async () => {
  const manager = createUpdateManager({ currentVersion: "1.3.1", repository: "example/project", fetchImpl: queuedFetch({ tag_name: "v1.4.0", name: "v1.4.0", body: "新增升级中心", html_url: "https://example.test/release" }) });
  const result = await manager.check();
  assert.equal(result.latestVersion, "1.4.0");
  assert.equal(result.commitSha, COMMIT_SHA);
  assert.equal(result.updateAvailable, true);
  assert.equal(result.repository, "example/project");
  assert.equal(result.releaseNotes, "新增升级中心");
});

test("uses an embedded commit SHA without an extra lookup", async () => {
  let calls = 0;
  const manager = createUpdateManager({
    currentVersion: "1.3.1",
    repository: "example/project",
    fetchImpl: async () => {
      calls += 1;
      return { ok: true, status: 200, async json() { return { tag_name: "v1.4.0", target_commitish: COMMIT_SHA }; } };
    }
  });
  const result = await manager.check();
  assert.equal(result.commitSha, COMMIT_SHA);
  assert.equal(calls, 1);
});

test("queues only the checked latest version and persists its commit SHA", async () => {
  const directory = mkdtempSync(join(tmpdir(), "labequip-update-test-"));
  try {
    const manager = createUpdateManager({ currentVersion: "1.3.1", repository: "example/project", requestFile: join(directory, "request.json"), statusFile: join(directory, "status.json"), fetchImpl: queuedFetch({ tag_name: "v1.4.0", name: "v1.4.0" }) });
    const result = await manager.requestUpgrade("1.4.0", { id: "dev", username: "developer", displayName: "开发者" });
    assert.equal(result.state, "queued");
    assert.equal(result.targetVersion, "1.4.0");
    assert.equal(result.commitSha, COMMIT_SHA);
    assert.match(readFileSync(join(directory, "status.json"), "utf8"), /queued/);
    assert.equal(JSON.parse(readFileSync(join(directory, "request.json"), "utf8")).actor.username, "developer");
    assert.equal(JSON.parse(readFileSync(join(directory, "request.json"), "utf8")).commitSha, COMMIT_SHA);
    await assert.rejects(manager.requestUpgrade("1.4.0", { id: "dev" }), /已有升级任务正在执行/);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test("falls back to the newest stable tag and carries its commit SHA", async () => {
  const manager = createUpdateManager({
    currentVersion: "1.3.1",
    repository: "example/project",
    fetchImpl: async (url) => {
      if (String(url).endsWith("/releases/latest")) return { ok: false, status: 404, async json() { return {}; } };
      if (String(url).endsWith("/tags?per_page=30")) return { ok: true, status: 200, async json() { return [{ name: "v1.4.0", commit: { sha: COMMIT_SHA } }]; } };
      throw new Error(`unexpected url ${url}`);
    }
  });
  const result = await manager.check();
  assert.equal(result.latestVersion, "1.4.0");
  assert.equal(result.commitSha, COMMIT_SHA);
});
