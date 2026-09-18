import { chmodSync, chownSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir, userInfo } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { normalizeVersion, compareVersions } from "../apps/api/lib/update.mjs";

const repository = process.env.UPDATE_REPOSITORY || "fluter1604191276/CIPC-LabEquip-Hub-Public";
const baseDirectory = resolve(process.env.UPDATE_BASE_DIR || "/opt/cipc-labequip");
const currentLink = resolve(process.env.UPDATE_CURRENT_LINK || join(baseDirectory, "current"));
const releasesDirectory = resolve(process.env.UPDATE_RELEASES_DIR || join(baseDirectory, "releases"));
const dataFile = resolve(process.env.DATA_FILE || "/var/lib/cipc-labequip/data/production.sqlite");
const backupDirectory = resolve(process.env.BACKUP_DIR || "/var/lib/cipc-labequip/backups");
const requestFile = resolve(process.env.UPDATE_REQUEST_FILE || "/var/lib/cipc-labequip/data/upgrade/request.json");
const statusFile = resolve(process.env.UPDATE_STATUS_FILE || "/var/lib/cipc-labequip/data/upgrade/status.json");
const serviceUser = process.env.UPDATE_SERVICE_USER || "cipc-labequip";
const serviceGroup = process.env.UPDATE_SERVICE_GROUP || serviceUser;
const apiService = process.env.UPDATE_API_SERVICE || "cipc-labequip-api.service";
const composeFile = resolve(process.env.UPDATE_COMPOSE_FILE || join(baseDirectory, "compose.yaml"));
const webHealthUrl = process.env.UPDATE_WEB_HEALTH_URL || "http://127.0.0.1:8080/healthz";
const apiHealthUrl = process.env.UPDATE_API_HEALTH_URL || "http://127.0.0.1:4000/api/health";
const nodeBinary = process.env.UPDATE_NODE || process.execPath;
let serviceIdentity;
try { serviceIdentity = userInfo({ username: serviceUser }); }
catch { serviceIdentity = { uid: process.getuid?.() ?? 0, gid: process.getgid?.() ?? 0 }; }

function now() { return new Date().toISOString(); }
function command(file, args, options = {}) { return execFileSync(file, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], ...options }); }
function readJson(path) { return JSON.parse(readFileSync(path, "utf8")); }
function writeStatus(value) {
  mkdirSync(join(statusFile, ".."), { recursive: true, mode: 0o750 });
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
async function downloadRelease(version, target) {
  const url = `https://github.com/${repository}/archive/refs/tags/v${version}.tar.gz`;
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
  for (const file of ["apps/api/server.mjs", "apps/api/lib/database.mjs", "apps/api/lib/service.mjs", "apps/api/lib/update.mjs", "apps/web/app.js"]) command(nodeBinary, ["--check", file], { cwd: directory });
  command(nodeBinary, ["--test", "apps/api/test/*.test.mjs", "apps/web/test/*.test.mjs", "scripts/test/*.test.mjs"], { cwd: directory, shell: true, stdio: "inherit" });
}
function backupDatabase(oldRelease) {
  command(process.env.UPDATE_NODE || "/usr/bin/node", [join(oldRelease, "scripts/backup-db.mjs"), "--data", dataFile, "--output-dir", backupDirectory, "--keep", "14"], { env: { ...process.env }, uid: undefined });
}
async function runOnce() {
  if (!existsSync(requestFile)) return { state: "idle", message: "没有待处理的升级任务" };
  const request = readJson(requestFile);
  const targetVersion = normalizeVersion(request.version);
  if (request.repository !== repository) throw new Error("升级请求来源仓库不匹配");
  const oldRelease = currentRelease();
  const oldVersion = releaseVersion(oldRelease);
  const workDirectory = mkdtempSync(join(tmpdir(), "labequip-upgrade-"));
  let switched = false;
  let rollbackSource = oldRelease;
  statusMessage("running", `正在准备升级到 v${targetVersion}`, { requestId: request.id, currentVersion: process.env.APP_VERSION || "", targetVersion });
  try {
    const release = await downloadRelease(targetVersion, workDirectory);
    runReleaseChecks(release);
    if (compareVersions(targetVersion, oldVersion) <= 0) throw new Error("目标版本不是更新版本");
    mkdirSync(releasesDirectory, { recursive: true });
    const releaseDirectory = join(releasesDirectory, releaseStamp(targetVersion, request.id));
    renameSync(release, releaseDirectory);
    command("chmod", ["-R", "a+rX", releaseDirectory]);
    const legacyCurrentDirectory = currentIsDirectory();
    const previousDirectory = legacyCurrentDirectory ? join(releasesDirectory, `previous-${request.id}`) : "";
    rollbackSource = legacyCurrentDirectory ? previousDirectory : oldRelease;
    statusMessage("running", "正在创建数据库快照", { requestId: request.id, targetVersion, releaseDirectory });
    backupDatabase(oldRelease);
    command("chown", ["-R", `${serviceUser}:${serviceGroup}`, backupDirectory]);
    statusMessage("running", "正在切换服务版本", { requestId: request.id, targetVersion, releaseDirectory });
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
    await assertHealthy(`${apiHealthUrl}`);
    statusMessage("completed", `已成功升级到 v${targetVersion}`, { requestId: request.id, currentVersion: targetVersion, targetVersion, releaseDirectory, previousRelease: oldRelease });
    renameSync(requestFile, `${requestFile}.completed-${request.id}`);
    return { state: "completed", targetVersion };
  } catch (error) {
    if (switched) {
      const rollbackLink = `${currentLink}.rollback-${request.id}`;
      try {
        command("systemctl", ["stop", apiService]);
        command("docker", ["compose", "-f", composeFile, "stop", "web"]);
        if (currentIsDirectory()) {
          const failedDirectory = `${currentLink}.failed-${request.id}`;
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
    statusMessage("failed", `升级失败：${error.message}`, { requestId: request.id, targetVersion, previousRelease: oldRelease });
    renameSync(requestFile, `${requestFile}.failed-${request.id}`);
    return { state: "failed", error: error.message };
  } finally { rmSync(workDirectory, { recursive: true, force: true }); }
}

if (process.argv.includes("--once")) runOnce().then((result) => { if (result.state === "failed") process.exitCode = 1; }).catch((error) => { statusMessage("failed", `升级任务启动失败：${error.message}`); process.exitCode = 1; });
