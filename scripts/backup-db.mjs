import { existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";

function usage() {
  console.log("Usage: node scripts/backup-db.mjs [--data FILE] [--output-dir DIRECTORY] [--keep COUNT]");
}

function readArguments(argumentsList) {
  const options = {
    dataFile: process.env.DATA_FILE || "apps/api/data/development.sqlite",
    outputDirectory: process.env.BACKUP_DIR || "apps/api/data/backups",
    keep: Number(process.env.BACKUP_RETENTION || 14)
  };

  for (let index = 0; index < argumentsList.length; index += 1) {
    const argument = argumentsList[index];
    if (argument === "--help" || argument === "-h") {
      usage();
      process.exit(0);
    }
    const value = argumentsList[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`Missing value for ${argument}`);
    if (argument === "--data") options.dataFile = value;
    else if (argument === "--output-dir") options.outputDirectory = value;
    else if (argument === "--keep") options.keep = Number(value);
    else throw new Error(`Unknown option: ${argument}`);
    index += 1;
  }

  if (!Number.isSafeInteger(options.keep) || options.keep < 1) {
    throw new Error("--keep must be a positive integer");
  }
  return { ...options, dataFile: resolve(options.dataFile), outputDirectory: resolve(options.outputDirectory) };
}

function timestamp() {
  return new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

function pruneBackups(directory, keep) {
  const backups = readdirSync(directory)
    .filter((name) => /^cipc-labequip-\d{8}T\d{6}Z-[a-f0-9]{8}\.sqlite$/.test(name))
    .sort((left, right) => right.localeCompare(left));

  for (const backup of backups.slice(keep)) rmSync(resolve(directory, backup));
}

const options = readArguments(process.argv.slice(2));
if (!existsSync(options.dataFile)) throw new Error(`SQLite data file does not exist: ${options.dataFile}`);
mkdirSync(options.outputDirectory, { recursive: true });
const outputFile = resolve(options.outputDirectory, `cipc-labequip-${timestamp()}-${randomUUID().slice(0, 8)}.sqlite`);

const database = new DatabaseSync(options.dataFile, { readOnly: true });
try {
  // VACUUM INTO reads a transactionally consistent snapshot, including WAL content.
  database.prepare("VACUUM INTO ?").run(outputFile);
} finally {
  database.close();
}

let integrityDatabase;
try {
  integrityDatabase = new DatabaseSync(outputFile, { readOnly: true });
  const integrity = integrityDatabase.prepare("PRAGMA integrity_check").get()?.integrity_check;
  if (integrity !== "ok") throw new Error(`SQLite integrity check failed: ${integrity || "no result"}`);
} catch (error) {
  rmSync(outputFile, { force: true });
  throw error;
} finally {
  integrityDatabase?.close();
}

pruneBackups(options.outputDirectory, options.keep);
console.log(`Verified SQLite backup: ${outputFile}`);
