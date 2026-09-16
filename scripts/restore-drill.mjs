import { copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { pathToFileURL } from "node:url";

export function runRestoreDrill({ backupFile, workDirectory = "", keep = false } = {}) {
  const source = resolve(backupFile || "");
  if (!backupFile || !existsSync(source)) throw new Error(`Backup file does not exist: ${source}`);
  const parentDirectory = workDirectory ? resolve(workDirectory) : tmpdir();
  mkdirSync(parentDirectory, { recursive: true });
  const directory = mkdtempSync(resolve(parentDirectory, "cipc-restore-drill-"));
  const restoredFile = resolve(directory, `restored-${basename(source)}`);
  copyFileSync(source, restoredFile);
  let database;
  try {
    database = new DatabaseSync(restoredFile);
    const integrity = database.prepare("PRAGMA integrity_check").get()?.integrity_check;
    if (integrity !== "ok") throw new Error(`Restored SQLite integrity check failed: ${integrity || "no result"}`);
    const requiredTables = ["users", "equipment", "reservations", "meeting_rooms", "audit_logs"];
    const tables = new Set(database.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((row) => row.name));
    const missingTables = requiredTables.filter((table) => !tables.has(table));
    if (missingTables.length) throw new Error(`Restored database is missing tables: ${missingTables.join(", ")}`);
    const counts = Object.fromEntries(requiredTables.map((table) => [table, database.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count]));
    return { status: "ok", source, restoredFile, integrity, counts, kept: keep };
  } finally {
    database?.close();
    if (!keep) rmSync(directory, { recursive: true, force: true });
  }
}

function readArguments(args) {
  const options = { backupFile: "", workDirectory: "", keep: false };
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--keep") { options.keep = true; continue; }
    const value = args[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`Missing value for ${argument}`);
    if (argument === "--backup") options.backupFile = value;
    else if (argument === "--work-dir") options.workDirectory = value;
    else throw new Error(`Unknown option: ${argument}`);
    index += 1;
  }
  return options;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    console.log(JSON.stringify(runRestoreDrill(readArguments(process.argv.slice(2))), null, 2));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
