import { execFileSync } from "node:child_process";

const checks = [
  { name: "Node.js", command: "node", args: ["--version"], required: true },
  { name: "pnpm", command: "pnpm", args: ["--version"], required: true },
  { name: "Git", command: "git", args: ["--version"], required: true },
  { name: "Docker", command: "docker", args: ["--version"], required: false },
  {
    name: "Docker Compose",
    command: "docker",
    args: ["compose", "version"],
    required: false
  }
];

let requiredFailure = false;

for (const check of checks) {
  try {
    const version = execFileSync(check.command, check.args, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"]
    }).trim();
    console.log(`[ok] ${check.name}: ${version}`);
  } catch {
    const level = check.required ? "error" : "missing";
    console.log(`[${level}] ${check.name}`);
    requiredFailure ||= check.required;
  }
}

if (requiredFailure) {
  process.exitCode = 1;
} else {
  console.log("\nCore development tools are ready.");
  console.log("Docker is optional for the current SQLite MVP.");
}
