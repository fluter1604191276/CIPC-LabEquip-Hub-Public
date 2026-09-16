import { spawn } from "node:child_process";

const processes = [
  spawn(process.execPath, ["apps/api/server.mjs"], { stdio: "inherit", env: process.env }),
  spawn(process.execPath, ["scripts/dev-web.mjs"], { stdio: "inherit", env: process.env })
];

let stopping = false;
function stop(exitCode = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of processes) child.kill("SIGTERM");
  setTimeout(() => process.exit(exitCode), 100).unref();
}

for (const child of processes) {
  child.on("exit", (code, signal) => {
    if (!stopping && code !== 0) {
      console.error(`Development service stopped unexpectedly (${signal || code}).`);
      stop(code || 1);
    }
  });
}

process.on("SIGINT", () => stop());
process.on("SIGTERM", () => stop());
