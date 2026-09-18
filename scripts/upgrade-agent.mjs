import { chmodSync, chownSync, cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir, userInfo } from "node:os";
import { dirname, join, resolve } from "node:path";
import { normalizeVersion, compareVersions } from "../apps/api/lib/update.mjs";

const repository = process.env.UPDATE_REPOSITORY || "fluter1604191276/CIPC-LabEquip-Hub-Public";
const baseDirectory = resolve(process.env.UPDATE_BASE_DIR || "/opt/cipc-labequip");
const currentLink = resolve(process.env.UPDATE_CURRENT_LINK || join(baseDirectory, "current"));
const releasesDirectory = resolve(process.env.UPDATE_RELEASES_DIR || join(baseDirectory, "releases"));
const dataFile = resolve(process.env.DATA_FILE || "/var/lib/cipc-labequip/data/production.sqlite");
const backupDirectory = resolve(process.env.BACKUP_DIR || "/var/lib/cipc-labequip/backups");
const requestFile = resolve(process.env.UPDATE_REQUEST_FILE || "/var/lib/cipc-labequip/data/upgrade/request.json");
const statusFile = resolve(process.env.UPDATE_STATUS_FILE || "/var/lib/cipc-labequip/data/upgrade/status.json");
const lockDirectory = resolve(process.env.UPDATE_LOCK_DIRECTORY || join(dirname(requestFile), ".upgrade-lock"));
const serviceUser = process.env.UPDATE_SERVICE_USER || "cipc-labequip";
const serviceGroup = process.env.UPDATE_SERVICE_GROUP || serviceUser;
const apiService = process.env.UPDATE_API_SERVICE || "cipc-labequip-api.service";
const composeFile = resolve(process.env.UPDATE_COMPOSE_FILE || join(baseDirectory, "compose.yaml"));
const webHealthUrl = process.env.UPDATE_WEB_HEALTH_URL || "http://127.0.0.1:8080/healthz";
const apiHealthUrl = process.env.UPDATE_API_HEALTH_URL || "http://127.0.0.1:4000/api/health";
const nodeBinary = process.env.UPDATE_NODE || process.execPath;
const staleStatusMs = Number(process.env.UPDATE_STALE_STATUS_MS || 30 * 60 * 1000);
const commitShaPattern = /^[0-9a-f]{40}$/i;
let serviceIdentity;
try { serviceIdentity = userInfo({ username: serviceUser }); }
catch { serviceIdentity = { uid: process.getuid?.() ?? 0, gid: process.getgid?.() ?? 0 }; }

function now() { return new Date().toISOString(); }
function command(file, args, options = {}) { return execFileSync(file, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], ...options }); }
function readJson(path) { return JSON.parse(readFileSync(path, "utf8")); }
function readStatus() { try { return readJson(statusFile); } catch { return null; } }
function recoverOrphanedStatus() {
  const status = readStatus();
  if (!status || !["queued", "running"].includes(status.state)) return false;
  const updatedAt = Date.parse(status.updatedAt || status.requestedAt || "");
  if (!Number.isFinite(updatedAt) || Date.now() - updatedAt < staleStatusMs) return false;
  let request = null;
  try { if (existsSync(requestFile)) request = readJson(requestFile); } catch { /* quarantine below */ }
  const requestId = request?.id || status.requestId || "unknown";
  const quarantinedRequest = quarantineRequest("stale", requestId);
  statusMessage("failed", "升级任务超时，已自动恢复为失败状态", {
    requestId,
    currentVersion: status.currentVersion || null,
    targetVersion: status.targetVersion || request?.version || null,
    commitSha: status.commitSha || request?.commitSha || null,
    previousRelease: status.previousRelease || null,
    quarantinedRequest
  });
  return true;
}
function writeStatus(value) {
  mkdirSync(dirname(statusFile), { recursive: true, mode: 0o750 });
  const temporary = `${statusFile}.${process.pid}.tmp`;
  writeFileSync(temporary, `${JSON.stringify({ ...value, updatedAt: now() }, null, 2)}\n`, { mode: 0o640 });
  chownSync(temporary, serviceIdentity.uid, serviceIdentity.gid);
  renameSync(temporary, statusFile);
  chmodSync(statusFile, 0o640);
}
function statusMessage(state, message, extra = {}) { writeStatus({ state, message, ...extra }); }
function currentRelease() { return command("readlink", ["-f", currentLink]).trim(); }
function releaseVersion(directory) {
  try { return JSON.parse(readFileSync(join(directory, "package.json"), "utf8")).version || process.env.APP_VERSION || "0.0.0"; }
  catch { return process.env.APP_VERSION || "0.0.0"; }
}
function currentIsDirectory() { return lstatSync(currentLink).isDirectory() && !lstatSync(currentLink).isSymbolicLink(); }
function releaseStamp(version, id) { return `${new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z")}-v${version}-${id.slice(0, 8)}`; }
function archiveRoot(directory) {
  const entries = readdirSync(directory, { withFileTypes: true }).filter((entry) => entry.isDirectory());
  if (entries.length !== 1) throw new Error("发布压缩包目录结构异常");
  return join(directory, entries[0].name);
}
function assertCommitSha(value) {
  const sha = String(value || "").trim().toLowerCase();
  if (!commitShaPattern.test(sha)) throw new Error("升级请求缺少有效的提交 SHA，请重新检查更新");
  return sha;
}
async function assertTagCommit(tagName, expectedSha) {
  const tag = String(tagName || "").trim();
  if (!tag) throw new Error("升级请求缺少版本标签");
  const response = await fetch(`https://api.github.com/repos/${repository}/commits/${encodeURIComponent(tag)}`, {
    signal: AbortSignal.timeout(8_000),
    headers: { Accept: "application/vnd.github+json", "User-Agent": "laboratory-resource-hub-updater" }
  });
  if (!response.ok) throw new Error(`无法验证版本标签：HTTP ${response.status}`);
  const commit = await response.json();
  if (String(commit?.sha || "").trim().toLowerCase() !== assertCommitSha(expectedSha)) throw new Error("版本标签与提交 SHA 不匹配");
}
function lockOwnerFile() { return join(lockDirectory, "owner.json"); }
function processIsAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; } catch (error) { return error.code === "EPERM"; }
}
function acquireLock() {
  mkdirSync(dirname(lockDirectory), { recursive: true, mode: 0o750 });
  try {
    mkdirSync(lockDirectory, { mode: 0o750 });
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
    let owner = null;
    try { owner = JSON.parse(readFileSync(lockOwnerFile(), "utf8")); } catch { /* stale or incomplete lock */ }
    if (processIsAlive(Number(owner?.pid))) throw new Error("已有升级任务正在执行");
    rmSync(lockDirectory, { recursive: true, force: true });
    mkdirSync(lockDirectory, { mode: 0o750 });
  }
  writeFileSync(lockOwnerFile(), `${JSON.stringify({ pid: process.pid, startedAt: now() })}\n`, { mode: 0o640 });
  return () => rmSync(lockDirectory, { recursive: true, force: true });
}
function quarantineRequest(suffix, requestId = "unknown") {
  if (!existsSync(requestFile)) return null;
  const safeId = String(requestId).replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 80) || "unknown";
  const destination = `${requestFile}.${suffix}-${safeId}`;
  try { renameSync(requestFile, destination); return destination; } catch { return null; }
}
function testFiles(directory) {
  return ["apps/api/test", "apps/web/test", "scripts/test"].flatMap((relativeDirectory) => {
    const absoluteDirectory = join(directory, relativeDirectory);
    if (!existsSync(absoluteDirectory)) return [];
    return readdirSync(absoluteDirectory).filter((file) => file.endsWith(".test.mjs")).sort().map((file) => join(relativeDirectory, file));
  });
}
async function downloadRelease(version, commitSha, target) {
  const ref = assertCommitSha(commitSha);
  const url = `https://github.com/${repository}/archive/${ref}.tar.gz`;
  const response = await fetch(url, { signal: AbortSignal.timeout(30_000), headers: { "User-Agent": "laboratory-resource-hub-updater" } });
  if (!response.ok) throw new Error(`下载版本失败：HTTP ${response.status}`);
  const archive = join(target, "release.tar.gz");
  writeFileSync(archive, Buffer.from(await response.arrayBuffer()), { mode: 0o600 });
  command("tar", ["-xzf", archive, "-C", target]);
  return archiveRoot(target);
}
async function assertHealthy(url) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(3_000) });
      if (response.ok && (url.endsWith("healthz") || (await response.json()).status === "ok")) return;
    } catch {}
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 1000));
  }
  throw new Error(`健康检查超时：${url}`);
}
function runReleaseChecks(directory) {
  command("chmod", ["-R", "a+rX", directory]);
  for (const file of ["apps/api/server.mjs", "apps/api/lib/database.mjs", "apps/api/lib/service.mjs", "apps/api/lib/update.mjs", "apps/web/app.js"]) command(nodeBinary, ["--check", file], { cwd: directory, uid: serviceIdentity.uid, gid: serviceIdentity.gid });
  const files = testFiles(directory);
  if (!files.length) throw new Error("发布包缺少测试文件");
  command(nodeBinary, ["--test", ...files], { cwd: directory, uid: serviceIdentity.uid, gid: serviceIdentity.gid, stdio: "inherit" });
}
function backupDatabase(oldRelease) {
  command(nodeBinary, [join(oldRelease, "scripts/backup-db.mjs"), "--data", dataFile, "--output-dir", backupDirectory, "--keep", "14"], { env: { ...process.env }, uid: undefined });
}
async function runOnce() {
  let releaseLock;
  try { releaseLock = acquireLock(); }
  catch (error) { if (error.message === "已有升级任务正在执行") return { state: "busy", message: error.message }; throw error; }
  let request = null;
  let workDirectory = null;
  let switched = false;
  let rollbackSource = null;
  let oldRelease = null;
  let oldVersion = null;
  let targetVersion = null;
  let commitSha = null;
  let tagName = null;
  try {
    if (recoverOrphanedStatus()) return { state: "recovered", message: "已恢复超时升级任务" };
    if (!existsSync(requestFile)) return { state: "idle", message: "没有待处理的升级任务" };
    request = readJson(requestFile);
    targetVersion = normalizeVersion(request.version);
    if (request.repository !== repository) throw new Error("升级请求来源仓库不匹配");
    commitSha = assertCommitSha(request.commitSha);
    tagName = String(request.tagName || `v${targetVersion}`).trim();
    oldRelease = currentRelease();
    oldVersion = releaseVersion(oldRelease);
    if (compareVersions(targetVersion, oldVersion) <= 0) throw new Error("目标版本不是更新版本");
    await assertTagCommit(tagName, commitSha);
    workDirectory = mkdtempSync(join(tmpdir(), "labequip-upgrade-"));
    statusMessage("running", `正在准备升级到 v${targetVersion}`, { requestId: request.id, currentVersion: oldVersion, targetVersion, tagName, commitSha });
    const release = await downloadRelease(targetVersion, commitSha, workDirectory);
    runReleaseChecks(release);
    mkdirSync(releasesDirectory, { recursive: true });
    const releaseDirectory = join(releasesDirectory, releaseStamp(targetVersion, request.id));
    // The temporary directory may be mounted on a different filesystem than
    // /opt. Copy instead of rename so upgrades work with /tmp tmpfs mounts.
    mkdirSync(releaseDirectory, { recursive: true });
    cpSync(release, releaseDirectory, { recursive: true, force: false, errorOnExist: true });
    rmSync(release, { recursive: true, force: true });
    command("chmod", ["-R", "a+rX", releaseDirectory]);
    const legacyCurrentDirectory = currentIsDirectory();
    const previousDirectory = legacyCurrentDirectory ? join(releasesDirectory, `previous-${request.id}`) : "";
    rollbackSource = legacyCurrentDirectory ? previousDirectory : oldRelease;
    statusMessage("running", "正在创建数据库快照", { requestId: request.id, currentVersion: oldVersion, targetVersion, tagName, commitSha, releaseDirectory });
    backupDatabase(oldRelease);
    command("chown", ["-R", `${serviceUser}:${serviceGroup}`, backupDirectory]);
    statusMessage("running", "正在切换服务版本", { requestId: request.id, currentVersion: oldVersion, targetVersion, tagName, commitSha, releaseDirectory });
    command("docker", ["compose", "-f", composeFile, "stop", "web"]);
    command("systemctl", ["stop", apiService]);
    if (legacyCurrentDirectory) {
      renameSync(currentLink, previousDirectory);
      renameSync(releaseDirectory, currentLink);
    } else {
      const nextLink = `${currentLink}.next-${request.id}`;
      symlinkSync(releaseDirectory, nextLink);
      renameSync(nextLink, currentLink);
    }
    switched = true;
    command("systemctl", ["start", apiService]);
    await assertHealthy(apiHealthUrl);
    command("docker", ["compose", "-f", composeFile, "up", "-d", "--no-deps", "--force-recreate", "web"]);
    await assertHealthy(webHealthUrl);
    await assertHealthy(apiHealthUrl);
    statusMessage("completed", `已成功升级到 v${targetVersion}`, { requestId: request.id, currentVersion: targetVersion, targetVersion, tagName, commitSha, releaseDirectory, previousRelease: oldRelease });
    quarantineRequest("completed", request.id);
    return { state: "completed", targetVersion };
  } catch (error) {
    if (switched && oldRelease) {
      const rollbackLink = `${currentLink}.rollback-${request?.id || "unknown"}`;
      try {
        command("systemctl", ["stop", apiService]);
        command("docker", ["compose", "-f", composeFile, "stop", "web"]);
        if (currentIsDirectory()) {
          const failedDirectory = `${currentLink}.failed-${request?.id || "unknown"}`;
          renameSync(currentLink, failedDirectory);
          renameSync(rollbackSource, currentLink);
        } else {
          symlinkSync(oldRelease, rollbackLink);
          renameSync(rollbackLink, currentLink);
        }
        command("systemctl", ["start", apiService]);
        await assertHealthy(apiHealthUrl);
        command("docker", ["compose", "-f", composeFile, "up", "-d", "--no-deps", "--force-recreate", "web"]);
        await assertHealthy(webHealthUrl);
      } catch (rollbackError) { error.message += `；自动回滚失败：${rollbackError.message}`; }
    }
    const requestId = request?.id || "unknown";
    statusMessage("failed", `升级失败：${error.message}`, { requestId, currentVersion: oldVersion, targetVersion, tagName, commitSha, previousRelease: oldRelease });
    quarantineRequest(request ? "failed" : "invalid", requestId);
    return { state: "failed", error: error.message };
  } finally {
    if (workDirectory) rmSync(workDirectory, { recursive: true, force: true });
    releaseLock?.();
  }
}

if (process.argv.includes("--once")) runOnce().then((result) => { if (result.state === "failed") process.exitCode = 1; }).catch((error) => { statusMessage("failed", `升级任务启动失败：${error.message}`); process.exitCode = 1; });
