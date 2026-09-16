import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const backupScript = join(projectRoot, "scripts/backup-db.mjs");

function createWalDatabase(filePath) {
  const database = new DatabaseSync(filePath);
  database.exec("PRAGMA journal_mode = WAL; CREATE TABLE samples (id INTEGER PRIMARY KEY, label TEXT NOT NULL);");
  database.prepare("INSERT INTO samples (label) VALUES (?)").run("WAL 中的业务数据");
  database.close();
}

function runBackup(dataFile, outputDirectory, keep = 2) {
  return execFileSync(process.execPath, [backupScript, "--data", dataFile, "--output-dir", outputDirectory, "--keep", String(keep)], {
    cwd: projectRoot,
    encoding: "utf8"
  });
}

test("creates an integrity-checked snapshot that includes WAL data", () => {
  const directory = mkdtempSync(join(tmpdir(), "cipc-backup-test-"));
  const dataFile = join(directory, "source.sqlite");
  const outputDirectory = join(directory, "backups");
  try {
    createWalDatabase(dataFile);
    const output = runBackup(dataFile, outputDirectory);
    assert.match(output, /Verified SQLite backup:/);

    const [backupName] = readdirSync(outputDirectory);
    const backup = new DatabaseSync(join(outputDirectory, backupName), { readOnly: true });
    assert.equal(backup.prepare("PRAGMA integrity_check").get().integrity_check, "ok");
    assert.equal(backup.prepare("SELECT label FROM samples").get().label, "WAL 中的业务数据");
    backup.close();
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("retains only the configured number of verified snapshots", () => {
  const directory = mkdtempSync(join(tmpdir(), "cipc-backup-retention-"));
  const dataFile = join(directory, "source.sqlite");
  const outputDirectory = join(directory, "backups");
  try {
    createWalDatabase(dataFile);
    runBackup(dataFile, outputDirectory, 2);
    runBackup(dataFile, outputDirectory, 2);
    runBackup(dataFile, outputDirectory, 2);
    assert.equal(readdirSync(outputDirectory).filter((name) => name.endsWith(".sqlite")).length, 2);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("retention follows the filename timestamp instead of file modification time", () => {
  const directory = mkdtempSync(join(tmpdir(), "cipc-backup-order-"));
  const dataFile = join(directory, "source.sqlite");
  const outputDirectory = join(directory, "backups");
  const olderName = "cipc-labequip-20240101T000000Z-00000001.sqlite";
  const newerName = "cipc-labequip-20240102T000000Z-00000002.sqlite";
  try {
    createWalDatabase(dataFile);
    mkdirSync(outputDirectory);
    writeFileSync(join(outputDirectory, olderName), "old");
    writeFileSync(join(outputDirectory, newerName), "new");
    utimesSync(join(outputDirectory, olderName), new Date("2030-01-01T00:00:00Z"), new Date("2030-01-01T00:00:00Z"));
    utimesSync(join(outputDirectory, newerName), new Date("2020-01-01T00:00:00Z"), new Date("2020-01-01T00:00:00Z"));

    runBackup(dataFile, outputDirectory, 2);

    const backups = readdirSync(outputDirectory);
    assert.equal(backups.includes(olderName), false);
    assert.equal(backups.includes(newerName), true);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
