// Container entrypoint: makes sure TOKEN_ENC_KEY / WEBHOOK_SECRET / OAUTH_CLIENT_SECRET exist, then runs the given command.
// Secrets come from the environment if set; otherwise they are generated ONCE into $SECRETS_FILE (a file on the shared
// data volume, never in the image or the repo) so the api, worker and platform containers all agree.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";

const KEYS = { TOKEN_ENC_KEY: 32, WEBHOOK_SECRET: 24, OAUTH_CLIENT_SECRET: 24 };
const file = process.env.SECRETS_FILE || "/data/secrets.env";
const missing = Object.keys(KEYS).filter((k) => !process.env[k]);
if (missing.length) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const body = Object.entries(KEYS).map(([k, n]) => `${k}=${crypto.randomBytes(n).toString("hex")}`).join("\n") + "\n";
  try { fs.writeFileSync(file, body, { flag: "wx", mode: 0o600 }); } catch (e) { if (e.code !== "EEXIST") throw e; }
  for (let i = 0; i < 50 && !fs.readFileSync(file, "utf8").includes("OAUTH_CLIENT_SECRET="); i++) await new Promise((r) => setTimeout(r, 100));
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    const m = /^([A-Z_]+)=(.+)$/.exec(line);
    if (m && missing.includes(m[1])) process.env[m[1]] = m[2];
  }
}
const [cmd, ...args] = process.argv.slice(2);
const child = spawn(cmd, args, { stdio: "inherit", env: process.env });
for (const s of ["SIGTERM", "SIGINT"]) process.on(s, () => child.kill(s));
child.on("exit", (code, sig) => process.exit(code ?? (sig ? 1 : 0)));
