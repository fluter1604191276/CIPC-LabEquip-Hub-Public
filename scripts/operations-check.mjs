import { existsSync, readdirSync, statfsSync } from "node:fs";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { pathToFileURL } from "node:url";

function latestBackup(directory) {
  if (!existsSync(directory)) return null;
  const files = readdirSync(directory)
    .map((name) => ({ name, match: /^cipc-labequip-(\d{8}T\d{6}Z)-[a-f0-9]{8}\.sqlite$/.exec(name) }))
    .filter((entry) => entry.match)
    .map(({ name, match }) => {
      const compact = match[1];
      const timestamp = `${compact.slice(0, 4)}-${compact.slice(4, 6)}-${compact.slice(6, 8)}T${compact.slice(9, 11)}:${compact.slice(11, 13)}:${compact.slice(13, 15)}Z`;
      return { name, path: resolve(directory, name), timestamp, timestampMs: Date.parse(timestamp) };
    })
    .sort((left, right) => right.name.localeCompare(left.name));
  return files[0] || null;
}

export async function runOperationsCheck({ apiUrl = "", dataFile, backupDirectory, maxBackupAgeHours = 36, minFreeMb = 1024 } = {}) {
  const checks = {};
  const now = Date.now();
  const databasePath = resolve(dataFile || "");
  if (!dataFile || !existsSync(databasePath)) {
    checks.database = { status: "failed", reason: "missing", path: databasePath };
  } else {
    let database;
    try {
      database = new DatabaseSync(databasePath, { readOnly: true });
      const integrity = database.prepare("PRAGMA quick_check").get()?.quick_check || "unknown";
      checks.database = { status: integrity === "ok" ? "ok" : "failed", integrity, path: databasePath };
    } catch (error) {
      checks.database = { status: "failed", reason: error.message, path: databasePath };
    } finally { database?.close(); }
  }

  const backupPath = resolve(backupDirectory || "");
  const backup = backupDirectory ? latestBackup(backupPath) : null;
  if (!backup) checks.backup = { status: "failed", reason: "missing", directory: backupPath };
  else {
    const ageHours = (now - backup.timestampMs) / 3_600_000;
    const reason = !Number.isFinite(backup.timestampMs) ? "invalid_timestamp" : ageHours < 0 ? "future_timestamp" : ageHours > maxBackupAgeHours ? "stale" : undefined;
    checks.backup = { status: reason ? "failed" : "ok", file: backup.path, timestamp: backup.timestamp, ageHours: Number(ageHours.toFixed(2)), maxAgeHours: maxBackupAgeHours, ...(reason ? { reason } : {}) };
  }

  const diskTarget = backupDirectory && existsSync(backupPath) ? backupPath : existsSync(databasePath) ? databasePath : process.cwd();
  const disk = statfsSync(diskTarget);
  const freeMb = disk.bavail * disk.bsize / 1024 / 1024;
  checks.disk = { status: freeMb >= minFreeMb ? "ok" : "failed", freeMb: Number(freeMb.toFixed(1)), minimumMb: minFreeMb, path: diskTarget };

  if (!apiUrl) checks.api = { status: "failed", reason: "missing_url" };
  else {
    try {
      const response = await fetch(apiUrl, { signal: AbortSignal.timeout(5_000) });
      const payload = await response.json();
      checks.api = { status: response.ok && payload.status === "ok" ? "ok" : "failed", httpStatus: response.status, payload };
    } catch (error) { checks.api = { status: "failed", reason: error.message }; }
  }

  const status = Object.values(checks).every((check) => check.status === "ok") ? "ok" : "failed";
  return { status, checkedAt: new Date(now).toISOString(), checks };
}

function readArguments(args) {
  const options = { apiUrl: process.env.API_HEALTH_URL || "http://127.0.0.1:4000/api/health", dataFile: process.env.DATA_FILE || "apps/api/data/development.sqlite", backupDirectory: process.env.BACKUP_DIR || "apps/api/data/backups", maxBackupAgeHours: 36, minFreeMb: 1024 };
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    const value = args[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`Missing value for ${argument}`);
    if (argument === "--api") options.apiUrl = value;
    else if (argument === "--data") options.dataFile = value;
    else if (argument === "--backup-dir") options.backupDirectory = value;
    else if (argument === "--max-backup-age-hours") options.maxBackupAgeHours = Number(value);
    else if (argument === "--min-free-mb") options.minFreeMb = Number(value);
    else throw new Error(`Unknown option: ${argument}`);
    index += 1;
  }
  if (!Number.isFinite(options.maxBackupAgeHours) || options.maxBackupAgeHours <= 0) throw new Error("--max-backup-age-hours must be a positive number");
  if (!Number.isFinite(options.minFreeMb) || options.minFreeMb < 0) throw new Error("--min-free-mb must be zero or a positive number");
  return options;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  runOperationsCheck(readArguments(process.argv.slice(2))).then((result) => {
    console.log(JSON.stringify(result, null, 2));
    if (result.status !== "ok") process.exitCode = 1;
  }).catch((error) => { console.error(error.message); process.exitCode = 1; });
}
