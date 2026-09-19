import assert from "node:assert/strict";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createDatabase } from "../../apps/api/lib/database.mjs";
import { runOperationsCheck } from "../operations-check.mjs";
import { runRestoreDrill } from "../restore-drill.mjs";

function backupNameAt(date) {
  const timestamp = date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  return `cipc-labequip-${timestamp}-abcd1234.sqlite`;
}

test("restores a verified backup into an isolated disposable copy", () => {
  const directory = mkdtempSync(join(tmpdir(), "cipc-restore-test-"));
  try {
    const source = join(directory, "source.sqlite");
    const database = createDatabase(source);
    database.close();
    const backup = join(directory, "cipc-labequip-20260729T010203Z-abcd1234.sqlite");
    copyFileSync(source, backup);
    const result = runRestoreDrill({ backupFile: backup });
    assert.equal(result.status, "ok");
    assert.equal(result.integrity, "ok");
    assert.ok(result.counts.users > 0);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test("keeps a caller-provided work directory and removes only the disposable child", () => {
  const directory = mkdtempSync(join(tmpdir(), "cipc-restore-work-test-"));
  try {
    const source = join(directory, "source.sqlite");
    const database = createDatabase(source);
    database.close();
    const workDirectory = join(directory, "operator-workspace");
    mkdirSync(workDirectory);
    const sentinel = join(workDirectory, "keep.txt");
    writeFileSync(sentinel, "keep");
    const result = runRestoreDrill({ backupFile: source, workDirectory });
    assert.equal(result.status, "ok");
    assert.equal(existsSync(sentinel), true);
    assert.equal(existsSync(result.restoredFile), false);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test("checks database integrity, backup freshness, disk capacity, and scheduled unit hardening", async () => {
  const directory = mkdtempSync(join(tmpdir(), "cipc-operations-test-"));
  try {
    const dataFile = join(directory, "production.sqlite");
    const database = createDatabase(dataFile);
    database.close();
    const backups = join(directory, "backups");
    mkdirSync(backups);
    copyFileSync(dataFile, join(backups, backupNameAt(new Date())));
    const result = await runOperationsCheck({ apiUrl: "data:application/json,%7B%22status%22%3A%22ok%22%7D", dataFile, backupDirectory: backups, maxBackupAgeHours: 36, minFreeMb: 1 });
    assert.equal(result.status, "ok");
    assert.equal(result.checks.database.integrity, "ok");
    assert.equal(result.checks.backup.status, "ok");
    assert.equal(result.checks.disk.status, "ok");
    assert.equal(result.checks.api.status, "ok");

    const servicePath = new URL("../../deploy/vps/cipc-labequip-operations.service", import.meta.url);
    const timerPath = new URL("../../deploy/vps/cipc-labequip-operations.timer", import.meta.url);
    const backupServicePath = new URL("../../deploy/vps/cipc-labequip-backup.service", import.meta.url);
    const apiServicePath = new URL("../../deploy/vps/cipc-labequip-api.service", import.meta.url);
    const upgradeServicePath = new URL("../../deploy/lan/cipc-labequip-upgrade.service", import.meta.url);
    const upgradePathPath = new URL("../../deploy/lan/cipc-labequip-upgrade.path", import.meta.url);
    const manualUpgradePath = new URL("../upgrade-lan-from-v1.3.sh", import.meta.url);
    const bootstrapPath = new URL("../bootstrap-admin.mjs", import.meta.url);
    assert.equal(existsSync(servicePath), true);
    assert.equal(existsSync(timerPath), true);
    assert.equal(existsSync(backupServicePath), true);
    assert.equal(existsSync(apiServicePath), true);
    assert.equal(existsSync(upgradeServicePath), true);
    assert.equal(existsSync(upgradePathPath), true);
    assert.equal(existsSync(bootstrapPath), true);
    const serviceUnit = readFileSync(servicePath, "utf8");
    const timerUnit = readFileSync(timerPath, "utf8");
    const backupServiceUnit = readFileSync(backupServicePath, "utf8");
    const apiServiceUnit = readFileSync(apiServicePath, "utf8");
    const upgradeServiceUnit = readFileSync(upgradeServicePath, "utf8");
    const upgradePathUnit = readFileSync(upgradePathPath, "utf8");
    const manualUpgradeScript = readFileSync(manualUpgradePath, "utf8");
    assert.match(manualUpgradeScript, /VERSION="\${1:-v1\.4\.14}"/);
    assert.match(manualUpgradeScript, /用法：sudo bash upgrade-lan-from-v1\.3\.sh v1\.4\.14/);
    const lanNginxPath = new URL("../../deploy/lan/nginx.conf", import.meta.url);
    const lanComposePath = new URL("../../deploy/lan/compose.yaml", import.meta.url);
    const lanApiServicePath = new URL("../../deploy/lan/cipc-labequip-api.service", import.meta.url);
    const lanBackupServicePath = new URL("../../deploy/lan/cipc-labequip-backup.service", import.meta.url);
    const lanOperationsServicePath = new URL("../../deploy/lan/cipc-labequip-operations.service", import.meta.url);
    assert.equal(existsSync(lanNginxPath), true);
    assert.equal(existsSync(lanComposePath), true);
    assert.equal(existsSync(lanApiServicePath), true);
    assert.equal(existsSync(lanBackupServicePath), true);
    assert.equal(existsSync(lanOperationsServicePath), true);
    const lanNginx = readFileSync(lanNginxPath, "utf8");
    const lanCompose = readFileSync(lanComposePath, "utf8");
    const lanApiService = readFileSync(lanApiServicePath, "utf8");
    const lanBackupService = readFileSync(lanBackupServicePath, "utf8");
    const lanOperationsService = readFileSync(lanOperationsServicePath, "utf8");
    assert.match(lanNginx, /^    listen 0\.0\.0\.0:8080;$/m);
    assert.match(lanNginx, /^    allow 192\.168\.10\.0\/24;$/m);
    assert.doesNotMatch(lanNginx, /^    allow 10\.0\.0\.0\/8;$/m);
    assert.doesNotMatch(lanNginx, /^    allow 192\.168\.0\.0\/16;$/m);
    assert.match(lanNginx, /^    deny all;$/m);
    assert.match(lanNginx, /proxy_pass http:\/\/127\.0\.0\.1:4000/);
    assert.match(lanCompose, /network_mode: host/);
    assert.match(lanCompose, /127\.0\.0\.1:8080\/healthz/);
    assert.match(lanApiService, /^Environment=COOKIE_SECURE=false$/m);
    assert.match(lanApiService, /^Environment=DATA_FILE=\/var\/lib\/cipc-labequip\/data\/production\.sqlite$/m);
    assert.match(lanApiService, /^Environment=SEED_DEMO_USERS=false$/m);
    assert.match(lanApiService, /^ExecStart=\/usr\/bin\/node apps\/api\/server\.mjs$/m);
    assert.match(lanApiService, /^UMask=0077$/m);
    assert.match(lanApiService, /^ProtectSystem=strict$/m);
    assert.match(lanBackupService, /^ExecStart=\/usr\/bin\/node scripts\/backup-db\.mjs$/m);
    assert.match(lanBackupService, /^UMask=0077$/m);
    assert.match(lanOperationsService, /^ExecStart=\/usr\/bin\/node scripts\/operations-check\.mjs --max-backup-age-hours 36 --min-free-mb 1024$/m);
    assert.match(lanOperationsService, /^UMask=0077$/m);
    assert.match(serviceUnit, /^Group=cipc-labequip$/m);
    assert.match(serviceUnit, /^Environment=API_HEALTH_URL=http:\/\/127\.0\.0\.1:4000\/api\/health$/m);
    assert.match(serviceUnit, /^Environment=DATA_FILE=\/var\/lib\/cipc-labequip\/data\/production\.sqlite$/m);
    assert.match(serviceUnit, /^Environment=BACKUP_DIR=\/var\/lib\/cipc-labequip\/backups$/m);
    assert.match(serviceUnit, /^ExecStart=\/usr\/local\/bin\/node scripts\/operations-check\.mjs --max-backup-age-hours 36 --min-free-mb 1024$/m);
    assert.match(serviceUnit, /^ProtectSystem=strict$/m);
    assert.match(serviceUnit, /^ReadWritePaths=\/var\/lib\/cipc-labequip\/data$/m);
    assert.match(serviceUnit, /^ReadOnlyPaths=\/var\/lib\/cipc-labequip\/backups$/m);
    assert.doesNotMatch(serviceUnit, /^OnFailure=/m);
    assert.doesNotMatch(serviceUnit, /^Wants=/m);
    assert.doesNotMatch(serviceUnit, /^PrivateNetwork=/m);
    assert.match(timerUnit, /^OnBootSec=5min$/m);
    assert.match(timerUnit, /^OnUnitActiveSec=15min$/m);
    assert.match(timerUnit, /^Unit=cipc-labequip-operations\.service$/m);
    assert.doesNotMatch(timerUnit, /^Persistent=/m);
    assert.match(backupServiceUnit, /^ReadWritePaths=\/var\/lib\/cipc-labequip\/data$/m);
    assert.match(backupServiceUnit, /^ReadWritePaths=\/var\/lib\/cipc-labequip\/backups$/m);
    assert.doesNotMatch(backupServiceUnit, /^ReadOnlyPaths=\/var\/lib\/cipc-labequip\/data$/m);
    assert.match(apiServiceUnit, /^Environment=TRUST_PROXY=true$/m);
    assert.match(upgradeServiceUnit, /^ExecStart=\/usr\/bin\/flock -n \/var\/lib\/cipc-labequip\/data\/upgrade\/\.agent\.flock \/usr\/bin\/node \/opt\/cipc-labequip\/current\/scripts\/upgrade-agent\.mjs --once --flock-held$/m);
    assert.match(upgradeServiceUnit, /^TimeoutStartSec=15min$/m);
    assert.match(upgradeServiceUnit, /^Environment=UPDATE_REPOSITORY=fluter1604191276\/CIPC-LabEquip-Hub-Public$/m);
    assert.match(upgradePathUnit, /^PathExists=\/var\/lib\/cipc-labequip\/data\/upgrade\/request\.json$/m);
    assert.match(manualUpgradeScript, /flock -n 9/);
    assert.match(manualUpgradeScript, /STATE_DIR\/\.agent\.flock/);
    assert.match(manualUpgradeScript, /--manual-version "\$VERSION" --commit-sha "\$TARGET_COMMIT" --flock-held/);
    assert.doesNotMatch(manualUpgradeScript, /git switch|CURRENT\/\.git|var\/lock\/cipc/);
    assert.match(apiServiceUnit, /^Environment=SEED_DEMO_USERS=false$/m);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test("upgrade agent copies releases across filesystems instead of renaming /tmp", () => {
  const source = readFileSync(new URL("../upgrade-agent.mjs", import.meta.url), "utf8");
  assert.match(source, /cpSync\(release, releaseDirectory/);
  assert.match(source, /rmSync\(release, \{ recursive: true, force: true \}\)/);
  assert.match(source, /archive\/\$\{ref\}\.tar\.gz/);
  assert.match(source, /assertCommitSha\(request\.commitSha\)/);
  assert.match(source, /mkdirSync\(lockDirectory/);
  assert.match(source, /recoverOrphanedStatus/);
  assert.match(source, /assertTagCommit/);
  assert.match(source, /currentVersion: oldVersion/);
  assert.match(source, /UPDATE_STALE_STATUS_MS/);
  assert.doesNotMatch(source, /shell: true/);
});

test("fails when the API check is omitted or a touched backup filename is stale", async () => {
  const directory = mkdtempSync(join(tmpdir(), "cipc-operations-negative-test-"));
  try {
    const dataFile = join(directory, "production.sqlite");
    const database = createDatabase(dataFile);
    database.close();
    const backups = join(directory, "backups");
    mkdirSync(backups);
    copyFileSync(dataFile, join(backups, "cipc-labequip-20200101T000000Z-abcd1234.sqlite"));
    const result = await runOperationsCheck({ dataFile, backupDirectory: backups, maxBackupAgeHours: 36, minFreeMb: 1 });
    assert.equal(result.status, "failed");
    assert.equal(result.checks.api.reason, "missing_url");
    assert.equal(result.checks.backup.reason, "stale");

    const futureBackups = join(directory, "future-backups");
    mkdirSync(futureBackups);
    copyFileSync(dataFile, join(futureBackups, "cipc-labequip-20990101T000000Z-abcd1234.sqlite"));
    const future = await runOperationsCheck({ apiUrl: "data:application/json,%7B%22status%22%3A%22ok%22%7D", dataFile, backupDirectory: futureBackups, maxBackupAgeHours: 36, minFreeMb: 1 });
    assert.equal(future.status, "failed");
    assert.equal(future.checks.backup.reason, "future_timestamp");
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
