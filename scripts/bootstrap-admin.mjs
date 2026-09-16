import { resolve } from "node:path";
import { createDatabase, INITIAL_PASSWORD } from "../apps/api/lib/database.mjs";
import { createService } from "../apps/api/lib/service.mjs";

function readOption(args, name, fallback = "") {
  const index = args.indexOf(name);
  return index === -1 ? fallback : args[index + 1] || "";
}

function usage() {
  console.log("Usage: BOOTSTRAP_ADMIN_PASSWORD='...' node scripts/bootstrap-admin.mjs [--data FILE] [--username USERNAME] [--display-name NAME]");
}

const args = process.argv.slice(2);
if (args.includes("--help") || args.includes("-h")) {
  usage();
  process.exit(0);
}

const dataFile = resolve(readOption(args, "--data", process.env.DATA_FILE || "/var/lib/cipc-labequip/data/production.sqlite"));
const username = readOption(args, "--username", process.env.BOOTSTRAP_ADMIN_USERNAME || "").trim();
const displayName = readOption(args, "--display-name", process.env.BOOTSTRAP_ADMIN_DISPLAY_NAME || "系统管理员").trim();
const password = process.env.BOOTSTRAP_ADMIN_PASSWORD || "";

if (!username) throw new Error("需要 --username 或 BOOTSTRAP_ADMIN_USERNAME");
if (!password) throw new Error("需要通过 BOOTSTRAP_ADMIN_PASSWORD 提供一次性管理员密码");

const database = createDatabase(dataFile, { seedReferenceData: true, seedUsers: false });
try {
  const service = createService(database);
  if (service.listUsers().length > 0) throw new Error("数据库已有用户，未执行初始化；请使用成员管理或单独的恢复流程");
  const actor = { id: null, displayName: "系统初始化", username: "bootstrap", role: "developer" };
  const user = service.createUser({ username, displayName, role: "admin" }, actor);
  await service.changePassword(user.id, INITIAL_PASSWORD, password, actor);
  console.log(`Created administrator ${username} in ${dataFile}`);
} finally {
  database.close();
}
