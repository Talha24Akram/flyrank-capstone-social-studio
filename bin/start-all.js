// One command to run everything: fake platform + API + worker (separate processes, so the worker can be killed alone).
import { spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";

if (!fs.existsSync(".env")) {
  const hex = (n) => crypto.randomBytes(n).toString("hex");
  const base = fs.readFileSync(".env.example", "utf8")
    .replace(/^TOKEN_ENC_KEY=.*$/m, `TOKEN_ENC_KEY=${hex(32)}`)
    .replace(/^WEBHOOK_SECRET=.*$/m, `WEBHOOK_SECRET=${hex(24)}`)
    .replace(/^OAUTH_CLIENT_SECRET=.*$/m, `OAUTH_CLIENT_SECRET=${hex(24)}`);
  fs.writeFileSync(".env", base, { mode: 0o600 });
  console.log("[start] created .env with fresh random secrets (git-ignored)");
}

const procs = [
  ["platform", ["src/fake-platform/run.js"]],
  ["api", ["src/server.js"]],
  ["worker", ["src/jobs/runWorker.js"]],
];
const children = procs.map(([name, args]) => {
  const c = spawn(process.execPath, ["--no-warnings", ...args], { stdio: ["ignore", "pipe", "pipe"], env: process.env });
  const pre = (d) => d.toString().split("\n").filter(Boolean).forEach((l) => console.log(`[${name}] ${l}`));
  c.stdout.on("data", pre); c.stderr.on("data", pre);
  c.on("exit", (code) => console.log(`[${name}] exited ${code}`));
  return c;
});
const stop = () => { children.forEach((c) => c.kill("SIGTERM")); setTimeout(() => process.exit(0), 300); };
process.on("SIGINT", stop); process.on("SIGTERM", stop);
console.log("[start] platform :4010, api :3000 (dashboard at /dashboard). Seed with: npm run seed");
