import * as fs from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { normalizeVersion, compareVersions } from "../apps/api/lib/update.mjs";

const commitShaPattern = /^[0-9a-f]{40}$/i;
const defaultRequestFile = "/var/lib/cipc-labequip/data/upgrade/request.json";
function command(file, args, options = {}) { return execFileSync(file, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], ...options }); }
function now() { return new Date().toISOString(); }
function assertCommitSha(value) {
  const sha = String(value || "").trim().toLowerCase();
  if (!commitShaPattern.test(sha)) throw new Error("升级请求缺少有效的提交 SHA，请重新检查更新");
  return sha;
}

// os.userInfo() describes the calling process, not an arbitrary account.
export function resolveServiceIdentity(user, group, execute = command) {
  if (!/^[a-z_][a-z0-9_-]*\$?$/i.test(user) || !/^[a-z_][a-z0-9_-]*\$?$/i.test(group)) throw new Error("服务账号或组名称无效");
  const uidText = execute("id", ["-u", user]).trim();
  const groupRecord = execute("getent", ["group", group]).trim().split(":");
  const gidText = groupRecord[2];
  if (!/^\d+$/.test(uidText) || !/^\d+$/.test(gidText || "") || groupRecord[0] !== group) throw new Error("服务账号或组解析失败");
  const uid = Number(uidText), gid = Number(gidText);
  if (!Number.isSafeInteger(uid) || !Number.isSafeInteger(gid) || uid <= 0 || gid <= 0) throw new Error("升级检查必须使用非 root 服务账号和组");
  return { uid, gid };
}

// Narrow I/O seams let fault tests use temporary files and fake service commands.
export function createUpgradeAgent({ env = process.env, command: execute = command, fileSystem = {}, fetchImpl = globalThis.fetch, downloadRelease: downloadOverride, assertHealthy: healthOverride } = {}) {
  const { chmodSync, chownSync, cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, symlinkSync, writeFileSync } = { ...fs, ...fileSystem };
  const repository = env.UPDATE_REPOSITORY || "fluter1604191276/CIPC-LabEquip-Hub-Public";
  if (!/^[\w.-]+\/[\w.-]+$/.test(repository)) throw new Error("UPDATE_REPOSITORY 格式无效");
  const baseDirectory = resolve(env.UPDATE_BASE_DIR || "/opt/cipc-labequip");
  const currentLink = resolve(env.UPDATE_CURRENT_LINK || join(baseDirectory, "current"));
  const releasesDirectory = resolve(env.UPDATE_RELEASES_DIR || join(baseDirectory, "releases"));
  const dataFile = resolve(env.DATA_FILE || "/var/lib/cipc-labequip/data/production.sqlite");
  const backupDirectory = resolve(env.BACKUP_DIR || "/var/lib/cipc-labequip/backups");
  const requestFile = resolve(env.UPDATE_REQUEST_FILE || defaultRequestFile);
  const statusFile = resolve(env.UPDATE_STATUS_FILE || join(dirname(requestFile), "status.json"));
  const lockDirectory = join(dirname(requestFile), ".upgrade-lock");
  const serviceUser = env.UPDATE_SERVICE_USER || "cipc-labequip";
  const serviceGroup = env.UPDATE_SERVICE_GROUP || serviceUser;
  const apiService = env.UPDATE_API_SERVICE || "cipc-labequip-api.service";
  const composeFile = resolve(env.UPDATE_COMPOSE_FILE || join(baseDirectory, "compose.yaml"));
  const webHealthUrl = env.UPDATE_WEB_HEALTH_URL || "http://127.0.0.1:8080/healthz";
  const apiHealthUrl = env.UPDATE_API_HEALTH_URL || "http://127.0.0.1:4000/api/health";
  const nodeBinary = env.UPDATE_NODE || process.execPath;
  const staleStatusMs = Number(env.UPDATE_STALE_STATUS_MS || 30 * 60 * 1000);
  let serviceIdentity;
  const readJson = (file) => JSON.parse(readFileSync(file, "utf8"));
  const readStatus = () => { try { return readJson(statusFile); } catch { return null; } };
  const currentRelease = () => realpathSync(currentLink);
  const releaseVersion = (directory) => normalizeVersion(readJson(join(directory, "package.json")).version);
  function currentVersion() { try { return releaseVersion(currentLink); } catch { return null; } }
  function currentPath() { try { return currentRelease(); } catch { return null; } }
  function writeStatus(value) {
    mkdirSync(dirname(statusFile), { recursive: true, mode: 0o750 });
    chownSync(dirname(statusFile), serviceIdentity.uid, serviceIdentity.gid);
    const temporary = `${statusFile}.${process.pid}.${randomUUID()}.tmp`;
    writeFileSync(temporary, `${JSON.stringify({ ...value, updatedAt: now() }, null, 2)}\n`, { mode: 0o640 });
    chownSync(temporary, serviceIdentity.uid, serviceIdentity.gid);
    renameSync(temporary, statusFile);
    chmodSync(statusFile, 0o640);
  }
  function statusMessage(state, message, extra = {}) { writeStatus({ state, message, ...extra }); }
  function quarantineRequest(suffix, requestId = "unknown") {
    if (!existsSync(requestFile)) return null;
    const safeId = String(requestId).replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 80) || "unknown";
    const destination = `${requestFile}.${suffix}-${safeId}`;
    renameSync(requestFile, destination);
    return destination;
  }
  function recoverOrphanedStatus() {
    const status = readStatus();
    if (!status || !["queued", "running"].includes(status.state)) return false;
    const updatedAt = Date.parse(status.updatedAt || status.requestedAt || "");
    if (!Number.isFinite(updatedAt) || Date.now() - updatedAt < staleStatusMs) return false;
    let request = null;
    try { if (existsSync(requestFile)) request = readJson(requestFile); } catch { /* quarantine below */ }
    const requestId = request?.id || status.requestId || "unknown";
    statusMessage("failed", "升级任务超时，已自动恢复为失败状态", { requestId, currentVersion: currentVersion(), currentRelease: currentPath(), targetVersion: status.targetVersion || request?.version || null, commitSha: status.commitSha || request?.commitSha || null, previousRelease: status.previousRelease || null, quarantinedRequest: quarantineRequest("stale", requestId) });
    return true;
  }
  function acquireLock(flockHeld) {
    mkdirSync(dirname(lockDirectory), { recursive: true, mode: 0o750 });
    try { mkdirSync(lockDirectory, { mode: 0o750 }); }
    catch (error) {
      if (error.code !== "EEXIST") throw error;
      // Only the OS-flock owner may remove a dead/incomplete legacy guard.
      // Direct library callers fail closed, including the mkdir→owner-write gap.
      if (!flockHeld) throw new Error("已有升级任务正在执行");
      let owner;
      try { owner = readJson(join(lockDirectory, "owner.json")); } catch { /* interrupted writer */ }
      if (!Number.isInteger(owner?.pid) || owner.pid <= 0) throw new Error("已有升级任务正在执行");
      if (Number.isInteger(owner?.pid) && owner.pid > 0) {
        try { process.kill(owner.pid, 0); throw new Error("已有升级任务正在执行"); }
        catch (probe) { if (probe.code !== "ESRCH") throw new Error("已有升级任务正在执行"); }
      }
      rmSync(lockDirectory, { recursive: true, force: true });
      mkdirSync(lockDirectory, { mode: 0o750 });
    }
    writeFileSync(join(lockDirectory, "owner.json"), `${JSON.stringify({ pid: process.pid, startedAt: now() })}\n`, { mode: 0o640 });
    return () => rmSync(lockDirectory, { recursive: true, force: true });
  }
  async function resolveTagCommit(tagName) {
    const response = await fetchImpl(`https://api.github.com/repos/${repository}/commits/${encodeURIComponent(tagName)}`, { signal: AbortSignal.timeout(8_000), headers: { Accept: "application/vnd.github+json", "User-Agent": "laboratory-resource-hub-updater" } });
    if (!response.ok) throw new Error(`版本标签验证失败：HTTP ${response.status}`);
    return assertCommitSha((await response.json())?.sha);
  }
  async function assertTagCommit(tagName, expectedSha) {
    if (!tagName || await resolveTagCommit(tagName) !== assertCommitSha(expectedSha)) throw new Error("版本标签与提交 SHA 不匹配");
  }
  async function downloadRelease(version, commitSha, target) {
    if (downloadOverride) return downloadOverride(version, commitSha, target);
    const ref = assertCommitSha(commitSha);
    const response = await fetchImpl(`https://github.com/${repository}/archive/${ref}.tar.gz`, { signal: AbortSignal.timeout(30_000), headers: { "User-Agent": "laboratory-resource-hub-updater" } });
    if (!response.ok) throw new Error(`下载版本失败：HTTP ${response.status}`);
    const archive = join(target, "release.tar.gz");
    writeFileSync(archive, Buffer.from(await response.arrayBuffer()), { mode: 0o600 });
    execute("tar", ["-xzf", archive, "-C", target]);
    const entries = readdirSync(target, { withFileTypes: true }).filter((entry) => entry.isDirectory());
    if (entries.length !== 1) throw new Error("发布压缩包目录结构异常");
    return join(target, entries[0].name);
  }
  async function assertHealthy(url) {
    if (healthOverride) return healthOverride(url);
    for (let attempt = 0; attempt < 20; attempt += 1) {
      try { const response = await fetchImpl(url, { signal: AbortSignal.timeout(3_000) }); if (response.ok && (url.endsWith("healthz") || (await response.json()).status === "ok")) return; } catch {}
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 1000));
    }
    throw new Error(`健康检查超时：${url}`);
  }
  function runReleaseChecks(directory) {
    execute("chmod", ["-R", "a+rX", directory]);
    const identityOptions = { cwd: directory, ...serviceIdentity };
    for (const file of ["apps/api/server.mjs", "apps/api/lib/database.mjs", "apps/api/lib/service.mjs", "apps/api/lib/update.mjs", "apps/web/app.js"]) execute(nodeBinary, ["--check", file], identityOptions);
    const files = ["apps/api/test", "apps/web/test", "scripts/test"].flatMap((relativeDirectory) => {
      const absolute = join(directory, relativeDirectory);
      return existsSync(absolute) ? readdirSync(absolute).filter((file) => file.endsWith(".test.mjs")).sort().map((file) => join(relativeDirectory, file)) : [];
    });
    if (!files.length) throw new Error("发布包缺少测试文件");
    execute(nodeBinary, ["--test", ...files], { ...identityOptions, stdio: "inherit" });
  }
  function backupDatabase(oldRelease) {
    mkdirSync(backupDirectory, { recursive: true, mode: 0o750 });
    chownSync(backupDirectory, serviceIdentity.uid, serviceIdentity.gid);
    execute(nodeBinary, [join(oldRelease, "scripts/backup-db.mjs"), "--data", dataFile, "--output-dir", backupDirectory, "--keep", "14"], { env: { ...process.env, ...env }, ...serviceIdentity });
  }
  const stopWeb = () => execute("docker", ["compose", "-f", composeFile, "stop", "web"]);
  const startWeb = () => execute("docker", ["compose", "-f", composeFile, "up", "-d", "--no-deps", "--force-recreate", "web"]);
  const stopApi = () => execute("systemctl", ["stop", apiService]);
  const startApi = () => execute("systemctl", ["start", apiService]);

  async function runOnce({ manualVersion, commitSha: manualSha, flockHeld = false } = {}) {
    let releaseLock;
    try { releaseLock = acquireLock(flockHeld); }
    catch (error) { if (error.message === "已有升级任务正在执行") return { state: "busy", message: error.message }; throw error; }
    let request, workDirectory, oldRelease, oldVersion, targetVersion, commitSha, tagName, releaseDirectory, previousDirectory, nextLink;
    let recoveryNeeded = false, legacyCurrentDirectory = false, manual = Boolean(manualVersion), requestOwned = false;
    try {
      // Fail closed before touching queued work when the service identity is invalid.
      serviceIdentity = resolveServiceIdentity(serviceUser, serviceGroup, execute);
      if (recoverOrphanedStatus()) return { state: "recovered", message: "已恢复超时升级任务" };
      if (manual) {
        if (existsSync(requestFile) || ["queued", "running"].includes(readStatus()?.state)) return { state: "busy", message: "已有升级任务正在执行" };
        targetVersion = normalizeVersion(manualVersion);
        tagName = String(manualVersion);
        request = { id: `manual-${randomUUID()}`, version: targetVersion, tagName, repository, commitSha: manualSha || await resolveTagCommit(tagName) };
      } else {
        if (!existsSync(requestFile)) return { state: "idle", message: "没有待处理的升级任务" };
        requestOwned = true; request = readJson(requestFile);
      }
      if (!/^[A-Za-z0-9._-]{1,100}$/.test(String(request.id || ""))) throw new Error("升级请求 ID 无效");
      targetVersion = normalizeVersion(request.version);
      if (request.repository !== repository) throw new Error("升级请求来源仓库不匹配");
      commitSha = assertCommitSha(request.commitSha);
      tagName = String(request.tagName || `v${targetVersion}`).trim();
      oldRelease = currentRelease(); oldVersion = releaseVersion(oldRelease);
      if (compareVersions(targetVersion, oldVersion) <= 0) throw new Error("目标版本不是更新版本");
      await assertTagCommit(tagName, commitSha);
      workDirectory = mkdtempSync(join(tmpdir(), "labequip-upgrade-"));
      // mkdtemp defaults to 0700. Children must reach candidate files after setuid.
      chmodSync(workDirectory, 0o755);
      statusMessage("running", `正在准备升级到 v${targetVersion}`, { requestId: request.id, currentVersion: oldVersion, targetVersion, tagName, commitSha });
      const release = await downloadRelease(targetVersion, commitSha, workDirectory);
      if (releaseVersion(release) !== targetVersion) throw new Error("发布包版本与升级目标不一致");
      runReleaseChecks(release);
      mkdirSync(releasesDirectory, { recursive: true });
      releaseDirectory = join(releasesDirectory, `${now().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z")}-v${targetVersion}-${request.id.slice(0, 16)}`);
      mkdirSync(releaseDirectory);
      // /tmp can be a separate filesystem: copy candidate files before downtime.
      cpSync(release, releaseDirectory, { recursive: true, force: false, errorOnExist: true });
      rmSync(release, { recursive: true, force: true });
      execute("chmod", ["-R", "a+rX", releaseDirectory]);
      legacyCurrentDirectory = lstatSync(currentLink).isDirectory() && !lstatSync(currentLink).isSymbolicLink();
      previousDirectory = legacyCurrentDirectory ? join(releasesDirectory, `previous-${request.id}`) : oldRelease;
      statusMessage("running", "正在创建数据库快照", { requestId: request.id, currentVersion: oldVersion, targetVersion, tagName, commitSha, releaseDirectory });
      backupDatabase(oldRelease);
      statusMessage("running", "正在切换服务版本", { requestId: request.id, currentVersion: oldVersion, targetVersion, tagName, commitSha, releaseDirectory, previousRelease: previousDirectory });
      // Establish compensation BEFORE the first possibly-partial stop command.
      recoveryNeeded = true;
      stopWeb(); stopApi();
      if (legacyCurrentDirectory) {
        renameSync(currentLink, previousDirectory);
        renameSync(releaseDirectory, currentLink);
        releaseDirectory = currentLink;
      } else {
        nextLink = `${currentLink}.next-${request.id}`;
        symlinkSync(releaseDirectory, nextLink); renameSync(nextLink, currentLink);
      }
      startApi(); await assertHealthy(apiHealthUrl);
      startWeb(); await assertHealthy(webHealthUrl); await assertHealthy(apiHealthUrl);
      statusMessage("completed", `已成功升级到 v${targetVersion}`, { requestId: request.id, currentVersion: targetVersion, targetVersion, tagName, commitSha, releaseDirectory, previousRelease: previousDirectory });
      if (requestOwned) quarantineRequest("completed", request.id);
      return { state: "completed", targetVersion };
    } catch (error) {
      const recoveryErrors = [];
      if (recoveryNeeded) {
        const attempt = async (label, action) => { try { await action(); } catch (failure) { recoveryErrors.push(`${label}: ${failure.message}`); } };
        await attempt("停止 API", stopApi); await attempt("停止 Web", stopWeb);
        await attempt("恢复版本目录", () => {
          if (legacyCurrentDirectory) {
            // Handles both current already moved away and candidate installed.
            if (existsSync(previousDirectory)) {
              if (existsSync(currentLink)) renameSync(currentLink, `${currentLink}.failed-${request.id}`);
              renameSync(previousDirectory, currentLink);
            }
          } else if (currentPath() !== oldRelease) {
            const rollbackLink = `${currentLink}.rollback-${request.id}`;
            symlinkSync(oldRelease, rollbackLink); renameSync(rollbackLink, currentLink);
          }
          if (currentVersion() !== oldVersion) throw new Error("旧版本目录尚未恢复");
        });
        // Try both services independently: an API start error must not skip Web.
        if (currentVersion() === oldVersion) {
          await attempt("启动 API", () => { startApi(); return assertHealthy(apiHealthUrl); });
          await attempt("启动 Web", () => { startWeb(); return assertHealthy(webHealthUrl); });
        }
      }
      if (recoveryErrors.length) error.message += `；自动恢复未完成：${recoveryErrors.join("；")}`;
      const rollbackState = recoveryNeeded ? (recoveryErrors.length ? "failed" : "completed") : "not-needed";
      if (serviceIdentity) statusMessage("failed", `升级失败：${error.message}`, { requestId: request?.id || "unknown", currentVersion: currentVersion(), currentRelease: currentPath(), targetVersion, tagName, commitSha, previousRelease: existsSync(previousDirectory || "") ? previousDirectory : currentVersion() === oldVersion ? currentPath() : null, rollbackState, recoveryErrors });
      if (requestOwned) quarantineRequest(request ? "failed" : "invalid", request?.id);
      return { state: "failed", error: error.message, rollbackState };
    } finally {
      if (nextLink) rmSync(nextLink, { force: true });
      if (workDirectory) rmSync(workDirectory, { recursive: true, force: true });
      releaseLock?.();
    }
  }
  return { runOnce };
}

// Older installed units already wrap this process in flock, but predate the
// --flock-held marker. Verify that exact parent invocation, rather than trying
// to acquire its own non-reentrant lock again after an automatic code upgrade.
export function hasLegacyFlockParent(lockFile, { readFileSync = fs.readFileSync, readlinkSync = fs.readlinkSync, ppid = process.ppid, script = process.argv[1] } = {}) {
  try {
    const executable = readlinkSync(`/proc/${ppid}/exe`);
    const args = readFileSync(`/proc/${ppid}/cmdline`, "utf8").split("\0").filter(Boolean);
    return /\/flock$/.test(executable) && args[1] === "-n" && resolve(args[2]) === lockFile && resolve(args[4]) === resolve(script);
  } catch { return false; }
}

// All CLI entrypoints use the SAME flock, including direct `node ... --once`.
// Units/manual bootstrap pass --flock-held only while already holding this lock.
export async function runCli(args = process.argv.slice(2), env = process.env) {
  const readArgument = (name) => { const index = args.indexOf(name); return index < 0 ? undefined : args[index + 1]; };
  if (!args.includes("--once") && !args.includes("--manual-version")) throw new Error("用法：upgrade-agent.mjs --once | --manual-version vX.Y.Z [--commit-sha SHA]");
  const directory = dirname(resolve(env.UPDATE_REQUEST_FILE || defaultRequestFile));
  if (!args.includes("--flock-held") && !hasLegacyFlockParent(join(directory, ".agent.flock"))) {
    fs.mkdirSync(directory, { recursive: true, mode: 0o750 });
    try {
      execFileSync("flock", ["-n", "-E", "75", join(directory, ".agent.flock"), env.UPDATE_NODE || process.execPath, fileURLToPath(import.meta.url), ...args, "--flock-held"], { stdio: "inherit", env });
      return 0;
    } catch (error) { if (error.status === 75) console.error("已有升级任务正在执行"); return error.status || 1; }
  }
  const result = await createUpgradeAgent({ env }).runOnce({ manualVersion: readArgument("--manual-version"), commitSha: readArgument("--commit-sha"), flockHeld: true });
  console.log(result.message || result.error || `${result.state}${result.targetVersion ? ` v${result.targetVersion}` : ""}`);
  return ["failed", "busy"].includes(result.state) ? 1 : 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) runCli().then((code) => { process.exitCode = code; }).catch((error) => { console.error(error.message); process.exitCode = 1; });
