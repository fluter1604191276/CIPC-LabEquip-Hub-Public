import assert from "node:assert/strict";
import * as fs from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createUpgradeAgent, resolveServiceIdentity } from "../upgrade-agent.mjs";

const sha = "a".repeat(40);
function fixture(t, { symlink = false, fail = "" } = {}) {
  const root = fs.mkdtempSync(join(tmpdir(), "labequip-agent-test-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const current = join(root, "current");
  const previous = symlink ? join(root, "initial-release") : current;
  fs.mkdirSync(previous); fs.writeFileSync(join(previous, "package.json"), JSON.stringify({ version: "1.0.0" }));
  if (symlink) fs.symlinkSync(previous, current);
  const state = join(root, "data", "upgrade"); fs.mkdirSync(state, { recursive: true });
  const env = { UPDATE_BASE_DIR: root, UPDATE_REQUEST_FILE: join(state, "request.json"), UPDATE_STATUS_FILE: join(state, "status.json"), UPDATE_SERVICE_USER: "test-user", UPDATE_SERVICE_GROUP: "test-group", DATA_FILE: join(root, "db.sqlite"), BACKUP_DIR: join(root, "backups") };
  const request = { id: "test-request", version: "2.0.0", tagName: "v2.0.0", repository: "fluter1604191276/CIPC-LabEquip-Hub-Public", commitSha: sha };
  fs.writeFileSync(env.UPDATE_REQUEST_FILE, JSON.stringify(request));
  const commands = [], ownership = [], services = { api: true, web: true };
  let failed = false;
  function inject(name) { if (!failed && fail === name) { failed = true; throw Error(`injected ${name}`); } }
  const command = (file, args, options = {}) => {
    commands.push({ file, args, options });
    if (file === "id") return "1201\n";
    if (file === "getent") return "test-group:x:1202:\n";
    if (file === "systemctl") { services.api = args[0] !== "stop"; inject(`${args[0]}-api`); }
    if (file === "docker") { const stop = args.includes("stop"); services.web = !stop; inject(stop ? "stop-web" : "start-web"); }
    return "";
  };
  const deps = {
    command,
    fileSystem: {
      chownSync: (...args) => ownership.push(args),
      renameSync: (from, to) => { if (from === current) inject("move-old"); if (to === current && from.includes("/releases/")) inject("move-new"); if (to === current && from.includes(".next-")) inject("link-swap"); fs.renameSync(from, to); },
      symlinkSync: (from, to) => { if (to.includes(".next-")) inject("create-link"); fs.symlinkSync(from, to); }
    },
    fetchImpl: async () => ({ ok: true, json: async () => ({ sha }) }),
    downloadRelease: async (_version, _sha, work) => {
      assert.equal(fs.statSync(work).mode & 0o777, 0o755, "service user must traverse staging parent");
      const release = join(work, "payload"); fs.mkdirSync(release);
      fs.writeFileSync(join(release, "package.json"), JSON.stringify({ version: "2.0.0" }));
      fs.mkdirSync(join(release, "scripts", "test"), { recursive: true }); fs.writeFileSync(join(release, "scripts", "test", "fake.test.mjs"), "");
      return release;
    },
    assertHealthy: async (url) => inject(url.includes(":4000/") ? "health-api" : "health-web")
  };
  const agent = createUpgradeAgent({ env, ...deps });
  return { root, current, previous, env, request, commands, ownership, services, deps, agent, status: () => JSON.parse(fs.readFileSync(env.UPDATE_STATUS_FILE, "utf8")) };
}

test("resolves configured user and distinct configured group, with no root fallback", () => {
  const calls = [];
  const identity = resolveServiceIdentity("app-user", "app-group", (file, args) => { calls.push([file, ...args]); return file === "id" ? "1201\n" : "app-group:x:1400:\n"; });
  assert.deepEqual(identity, { uid: 1201, gid: 1400 });
  assert.deepEqual(calls, [["id", "-u", "app-user"], ["getent", "group", "app-group"]]);
  assert.throws(() => resolveServiceIdentity("missing", "app-group", () => { throw Error("not found"); }), /not found/);
  assert.throws(() => resolveServiceIdentity("root", "root", (file) => file === "id" ? "0" : "root:x:0:"), /非 root/);
});

test("runs release checks and backup as configured uid/gid and writes readable status", async (t) => {
  const f = fixture(t);
  assert.equal((await f.agent.runOnce()).state, "completed");
  const childCommands = f.commands.filter(({ file }) => file === process.execPath);
  assert.ok(childCommands.some(({ args }) => args[0] === "--test"));
  assert.ok(childCommands.some(({ args }) => args[0].endsWith("backup-db.mjs")));
  for (const child of childCommands) { assert.equal(child.options.uid, 1201); assert.equal(child.options.gid, 1202); }
  assert.ok(f.ownership.some(([file, uid, gid]) => file.includes("status.json.") && uid === 1201 && gid === 1202));
  assert.equal(fs.statSync(f.env.UPDATE_STATUS_FILE).mode & 0o777, 0o640);
  assert.equal(f.status().currentVersion, "2.0.0");
  assert.ok(fs.existsSync(f.status().previousRelease));
});

for (const symlink of [false, true]) {
  const faults = ["stop-web", "stop-api", ...(symlink ? ["create-link", "link-swap"] : ["move-old", "move-new"]), "start-api", "health-api", "start-web", "health-web"];
  for (const fail of faults) test(`restores ${symlink ? "symlink" : "directory"} installation after ${fail}`, async (t) => {
    const f = fixture(t, { symlink, fail });
    const result = await f.agent.runOnce();
    assert.equal(result.state, "failed"); assert.match(result.error, new RegExp(fail));
    assert.ok(fs.existsSync(f.current));
    assert.equal(JSON.parse(fs.readFileSync(join(f.current, "package.json"))).version, "1.0.0");
    assert.deepEqual(f.services, { api: true, web: true });
    assert.equal(f.status().rollbackState, "completed");
    assert.equal(f.status().currentVersion, "1.0.0");
  });
}

test("manual archive upgrade after automatic archive upgrade shares the same pipeline", async (t) => {
  const f = fixture(t);
  assert.equal((await f.agent.runOnce()).state, "completed");
  assert.equal(fs.existsSync(join(f.current, ".git")), false);
  const downloadRelease = async (_version, _sha, work) => {
    const release = join(work, "payload"); fs.mkdirSync(release); fs.writeFileSync(join(release, "package.json"), '{"version":"3.0.0"}');
    fs.mkdirSync(join(release, "scripts", "test"), { recursive: true }); fs.writeFileSync(join(release, "scripts", "test", "fake.test.mjs"), ""); return release;
  };
  const second = createUpgradeAgent({ env: f.env, ...f.deps, downloadRelease });
  assert.equal((await second.runOnce({ manualVersion: "v3.0.0", commitSha: sha })).state, "completed");
  assert.equal(f.status().currentVersion, "3.0.0");
});

test("rejects candidate package version mismatch before stopping services", async (t) => {
  const f = fixture(t);
  const agent = createUpgradeAgent({ env: f.env, ...f.deps, downloadRelease: async (...args) => {
    const release = await f.deps.downloadRelease(...args); fs.writeFileSync(join(release, "package.json"), '{"version":"1.9.0"}'); return release;
  } });
  assert.equal((await agent.runOnce()).state, "failed");
  assert.ok(!f.commands.some(({ file }) => file === "systemctl" || file === "docker"));
});

test("direct and manual callers share an atomic guard and preserve queued requests", async (t) => {
  const f = fixture(t);
  let resume, entered;
  const waiting = new Promise((resolve) => { entered = resolve; });
  const gate = new Promise((resolve) => { resume = resolve; });
  const first = createUpgradeAgent({ env: f.env, ...f.deps, downloadRelease: async (...args) => { entered(); await gate; return f.deps.downloadRelease(...args); } });
  const pending = first.runOnce(); await waiting;
  const contender = await f.agent.runOnce({ manualVersion: "v3.0.0", commitSha: sha });
  assert.equal(contender.state, "busy"); assert.equal(JSON.parse(fs.readFileSync(f.env.UPDATE_REQUEST_FILE)).id, f.request.id);
  resume(); assert.equal((await pending).state, "completed");
});

test("identity lookup failure leaves request untouched and never stops services", async (t) => {
  const f = fixture(t);
  const agent = createUpgradeAgent({ env: f.env, ...f.deps, command: (file, args, options) => { if (file === "id") throw Error("missing service account"); return f.deps.command(file, args, options); } });
  const result = await agent.runOnce();
  assert.equal(result.state, "failed"); assert.match(result.error, /missing service account/);
  assert.equal(fs.existsSync(f.env.UPDATE_REQUEST_FILE), true);
  assert.equal(fs.existsSync(f.env.UPDATE_STATUS_FILE), false);
  assert.deepEqual(f.commands, []);
});

test("rollback filesystem failure is explicit and never claims old release is current", async (t) => {
  const f = fixture(t, { fail: "health-api" });
  const renameSync = (from, to) => {
    if (from.includes("/previous-") && to === f.current) throw Error("rollback disk failure");
    f.deps.fileSystem.renameSync(from, to);
  };
  const agent = createUpgradeAgent({ env: f.env, ...f.deps, fileSystem: { ...f.deps.fileSystem, renameSync } });
  const result = await agent.runOnce();
  assert.equal(result.state, "failed"); assert.match(result.error, /rollback disk failure/);
  assert.equal(f.status().rollbackState, "failed"); assert.equal(f.status().currentVersion, null); assert.equal(f.status().currentRelease, null);
  assert.ok(fs.existsSync(f.status().previousRelease), "old release must remain available for manual recovery");
});

test("rollback restarts Web even if the API restart continues failing", async (t) => {
  const f = fixture(t, { fail: "move-new" });
  const agent = createUpgradeAgent({ env: f.env, ...f.deps, command: (file, args, options) => {
    if (file === "systemctl" && args[0] === "start") throw Error("persistent API start failure");
    return f.deps.command(file, args, options);
  } });
  const result = await agent.runOnce();
  assert.equal(result.state, "failed"); assert.match(result.error, /persistent API start failure/);
  assert.equal(f.status().rollbackState, "failed"); assert.equal(f.services.web, true);
});

test("does not delete the owner's incomplete mkdir lock", async (t) => {
  const f = fixture(t);
  const lock = join(f.root, "data", "upgrade", ".upgrade-lock"); fs.mkdirSync(lock);
  assert.equal((await f.agent.runOnce()).state, "busy"); assert.equal(fs.existsSync(lock), true);
});

test("manual caller does not consume an already queued web request", async (t) => {
  const f = fixture(t);
  const result = await f.agent.runOnce({ manualVersion: "v3.0.0", commitSha: sha });
  assert.equal(result.state, "busy"); assert.equal(JSON.parse(fs.readFileSync(f.env.UPDATE_REQUEST_FILE)).id, f.request.id);
  assert.deepEqual(f.services, { api: true, web: true });
});

test("invalid request file is quarantined without stopping services", async (t) => {
  const f = fixture(t); fs.writeFileSync(f.env.UPDATE_REQUEST_FILE, "{");
  assert.equal((await f.agent.runOnce()).state, "failed");
  assert.equal(fs.existsSync(f.env.UPDATE_REQUEST_FILE), false);
  assert.ok(fs.existsSync(`${f.env.UPDATE_REQUEST_FILE}.invalid-unknown`));
  assert.deepEqual(f.services, { api: true, web: true });
});

test("accepts only the exact inherited legacy OS flock invocation", async () => {
  const { hasLegacyFlockParent } = await import("../upgrade-agent.mjs");
  const lockFile = "/tmp/test-data/upgrade/.agent.flock", script = "/opt/example/current/scripts/upgrade-agent.mjs";
  const options = { script, ppid: 123, readlinkSync: () => "/usr/bin/flock", readFileSync: () => ["/usr/bin/flock", "-n", lockFile, "/usr/bin/node", script, "--once", ""].join("\0") };
  assert.equal(hasLegacyFlockParent(lockFile, options), true);
  assert.equal(hasLegacyFlockParent("/tmp/another/.agent.flock", options), false);
  assert.equal(hasLegacyFlockParent(lockFile, { ...options, readlinkSync: () => "/bin/bash" }), false);
  assert.equal(hasLegacyFlockParent(lockFile, { ...options, script: "/tmp/another-agent.mjs" }), false);
});

test("manual bootstrap supports old/archive installs and preserves existing VPS settings", async (t) => {
  const { execFileSync } = await import("node:child_process");
  const f = fixture(t); const bin = join(f.root, "bin"), source = join(f.root, "archive-source");
  fs.mkdirSync(bin); fs.mkdirSync(join(source, "scripts"), { recursive: true });
  fs.writeFileSync(join(source, "package.json"), '{"version":"2.0.0"}');
  fs.writeFileSync(join(source, "scripts", "upgrade-agent.mjs"), `import { writeFileSync } from 'node:fs'; writeFileSync(process.env.TEST_RESULT, JSON.stringify({args:process.argv.slice(2), env:process.env}));`);
  const archive = join(f.root, "fixture.tar.gz");
  execFileSync("tar", ["-czf", archive, "-C", f.root, "archive-source"]);
  function executable(name, code) { const file = join(bin, name); fs.writeFileSync(file, `#!${process.execPath}\n${code}`, { mode: 0o755 }); }
  executable("id", 'console.log("0");');
  executable("flock", 'if(process.argv.slice(2).join(" ")!=="-n 9")process.exit(2);');
  executable("systemctl", `if(process.argv[2]!=="show")process.exit(3); console.log('UPDATE_WEB_HEALTH_URL=http://127.0.0.1:8020/healthz UPDATE_SERVICE_GROUP=site-group "UPDATE_COMPOSE_FILE=/opt/site with spaces/compose.yaml" UPDATE_NODE=${process.execPath} PATH=/evil');`);
  executable("curl", `import('node:fs').then(fs=>{const args=process.argv.slice(2), out=args[args.indexOf('-o')+1], url=args.find(a=>a.startsWith('https://')); fs.appendFileSync(process.env.TEST_CURL_LOG,url+'\\n'); if(url.includes('/commits/'))fs.writeFileSync(out,JSON.stringify({sha:'${sha}'})); else fs.copyFileSync(process.env.TEST_ARCHIVE,out);});`);
  const output = join(f.root, "manual-result.json"), curlLog = join(f.root, "curl.log");
  execFileSync("bash", [fileURLToPath(new URL("../upgrade-lan-from-v1.3.sh", import.meta.url)), "v2.0.0"], { env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, UPDATE_NODE: process.execPath, UPDATE_BASE_DIR: f.root, UPDATE_REQUEST_FILE: f.env.UPDATE_REQUEST_FILE, TEST_RESULT: output, TEST_ARCHIVE: archive, TEST_CURL_LOG: curlLog }, encoding: "utf8" });
  const result = JSON.parse(fs.readFileSync(output, "utf8"));
  assert.deepEqual(result.args, ["--manual-version", "v2.0.0", "--commit-sha", sha, "--flock-held"]);
  assert.equal(result.env.UPDATE_WEB_HEALTH_URL, "http://127.0.0.1:8020/healthz");
  assert.equal(result.env.UPDATE_SERVICE_GROUP, "site-group");
  assert.equal(result.env.UPDATE_COMPOSE_FILE, "/opt/site with spaces/compose.yaml");
  assert.notEqual(result.env.PATH, "/evil");
  assert.match(fs.readFileSync(curlLog, "utf8"), new RegExp(`archive/${sha}\\.tar\\.gz`));
  assert.equal(JSON.parse(fs.readFileSync(join(f.current, "package.json"))).version, "1.0.0", "bootstrap itself never switches current");
});

test("Linux root launcher actually drops test/backup identity and API user reads status", { skip: process.platform !== "linux" || process.getuid?.() !== 0 }, async (t) => {
  const { execFileSync } = await import("node:child_process");
  const root = fs.mkdtempSync(join(tmpdir(), "labequip-real-identity-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.chmodSync(root, 0o755);
  const identity = resolveServiceIdentity("nobody", "nogroup");
  const receipts = join(root, "receipts"); fs.mkdirSync(receipts); fs.chownSync(receipts, identity.uid, identity.gid);
  const current = join(root, "current"); fs.mkdirSync(join(current, "scripts"), { recursive: true });
  fs.writeFileSync(join(current, "package.json"), '{"version":"1.0.0"}');
  const receiptCode = (name) => `import { writeFileSync } from "node:fs"; writeFileSync(${JSON.stringify(join(receipts, name))}, JSON.stringify({uid:process.getuid(),gid:process.getgid(),groups:process.getgroups()}));`;
  fs.writeFileSync(join(current, "scripts", "backup-db.mjs"), receiptCode("backup.json"));
  const requestFile = join(root, "data", "upgrade", "request.json"), statusFile = join(root, "data", "upgrade", "status.json");
  fs.mkdirSync(join(root, "data", "upgrade"), { recursive: true });
  fs.writeFileSync(requestFile, JSON.stringify({ id: "linux-identity", version: "2.0.0", tagName: "v2.0.0", repository: "example/project", commitSha: sha }));
  const agent = createUpgradeAgent({
    env: { UPDATE_BASE_DIR: root, UPDATE_REPOSITORY: "example/project", UPDATE_REQUEST_FILE: requestFile, UPDATE_STATUS_FILE: statusFile, UPDATE_SERVICE_USER: "nobody", UPDATE_SERVICE_GROUP: "nogroup", DATA_FILE: join(root, "unused.sqlite"), BACKUP_DIR: join(root, "backups") },
    command: (file, args, options = {}) => {
      if (["docker", "systemctl"].includes(file)) return "";
      const childEnv = { ...process.env, ...options.env };
      delete childEnv.NODE_TEST_CONTEXT; // execute a real nested --test process
      return execFileSync(file, args, { encoding: "utf8", ...options, env: childEnv, stdio: "pipe" });
    },
    fetchImpl: async () => ({ ok: true, json: async () => ({ sha }) }),
    assertHealthy: async () => {},
    downloadRelease: async (_version, _sha, work) => {
      const release = join(work, "payload");
      fs.mkdirSync(join(release, "apps", "api", "lib"), { recursive: true });
      fs.mkdirSync(join(release, "apps", "web"), { recursive: true });
      fs.mkdirSync(join(release, "scripts", "test"), { recursive: true });
      fs.writeFileSync(join(release, "package.json"), '{"version":"2.0.0"}');
      for (const file of ["apps/api/server.mjs", "apps/api/lib/database.mjs", "apps/api/lib/service.mjs", "apps/api/lib/update.mjs", "apps/web/app.js"]) fs.writeFileSync(join(release, file), "");
      fs.writeFileSync(join(release, "scripts", "test", "identity.test.mjs"), receiptCode("test.json"));
      return release;
    }
  });
  assert.equal((await agent.runOnce()).state, "completed");
  for (const name of ["test.json", "backup.json"]) {
    const receipt = JSON.parse(fs.readFileSync(join(receipts, name), "utf8"));
    assert.equal(receipt.uid, identity.uid); assert.equal(receipt.gid, identity.gid); assert.ok(!receipt.groups.includes(0), "child must not retain root supplementary group");
  }
  const readableStatus = execFileSync(process.execPath, ["-e", "process.stdout.write(require('node:fs').readFileSync(process.argv[1],'utf8'))", statusFile], { encoding: "utf8", ...identity });
  assert.equal(JSON.parse(readableStatus).state, "completed");
  assert.equal(fs.statSync(statusFile).uid, identity.uid); assert.equal(fs.statSync(statusFile).gid, identity.gid);
});

test("Linux flock serializes direct CLI, legacy unit, and manual entry before any service action", { skip: process.platform !== "linux" }, async (t) => {
  const { spawn, execFileSync } = await import("node:child_process");
  const f = fixture(t); const state = join(f.root, "data", "upgrade"), lockFile = join(state, ".agent.flock");
  const keeper = spawn("flock", ["-n", lockFile, process.execPath, "-e", "console.log('locked');setTimeout(()=>{},30000)"], { stdio: ["ignore", "pipe", "pipe"], detached: true });
  t.after(() => { try { process.kill(-keeper.pid, "SIGTERM"); } catch {} });
  await new Promise((resolve, reject) => { keeper.stdout.once("data", resolve); keeper.once("error", reject); keeper.once("exit", (code) => reject(Error(`lock holder exited ${code}`))); });
  const script = fileURLToPath(new URL("../upgrade-agent.mjs", import.meta.url));
  assert.throws(() => execFileSync(process.execPath, [script, "--once"], { env: { ...process.env, ...f.env }, encoding: "utf8", stdio: "pipe" }), (error) => error.status === 75 && error.stderr.includes("已有升级任务"));
  assert.throws(() => execFileSync("flock", ["-n", lockFile, process.execPath, script, "--once"], { env: { ...process.env, ...f.env }, stdio: "pipe" }), (error) => error.status === 1);
  const bin = join(f.root, "manual-bin"); fs.mkdirSync(bin);
  for (const [name, body] of [["id", 'console.log("0");'], ["systemctl", 'process.exit(0);'], ["curl", 'process.stderr.write("network should not run");process.exit(99);']]) fs.writeFileSync(join(bin, name), `#!${process.execPath}\n${body}`, { mode: 0o755 });
  assert.throws(() => execFileSync("bash", [fileURLToPath(new URL("../upgrade-lan-from-v1.3.sh", import.meta.url)), "v2.0.0"], { env: { ...process.env, ...f.env, UPDATE_NODE: process.execPath, PATH: `${bin}:${process.env.PATH}` }, encoding: "utf8", stdio: "pipe" }), (error) => error.status === 1 && error.stderr.includes("已有升级任务"));
  assert.deepEqual(f.services, { api: true, web: true });
});

test("Linux legacy installed flock unit remains usable after an archive code upgrade", { skip: process.platform !== "linux" || process.getuid?.() !== 0 }, async (t) => {
  const { execFileSync } = await import("node:child_process");
  const f = fixture(t); fs.rmSync(f.env.UPDATE_REQUEST_FILE);
  const script = fileURLToPath(new URL("../upgrade-agent.mjs", import.meta.url));
  const lock = join(f.root, "data", "upgrade", ".agent.flock");
  const env = { ...process.env, ...f.env, UPDATE_SERVICE_USER: "nobody", UPDATE_SERVICE_GROUP: "nogroup" };
  const legacy = execFileSync("flock", ["-n", lock, process.execPath, script, "--once"], { env, encoding: "utf8", timeout: 5000 });
  assert.match(legacy, /没有待处理/);
  const direct = execFileSync(process.execPath, [script, "--once"], { env, encoding: "utf8", timeout: 5000 });
  assert.match(direct, /没有待处理/);
});
