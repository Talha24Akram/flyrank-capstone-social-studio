import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), "migrations");

export function migrate(db) {
  db.exec("CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL)");
  const applied = new Set(db.prepare("SELECT name FROM schema_migrations").all().map((r) => r.name));
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
  const done = [];
  for (const f of files) {
    if (applied.has(f)) continue;
    db.exec("BEGIN IMMEDIATE");
    try {
      db.exec(fs.readFileSync(path.join(dir, f), "utf8"));
      db.prepare("INSERT INTO schema_migrations(name, applied_at) VALUES (?, ?)").run(f, new Date().toISOString());
      db.exec("COMMIT");
      done.push(f);
    } catch (e) {
      db.exec("ROLLBACK");
      throw new Error(`migration ${f} failed: ${e.message}`);
    }
  }
  return done;
}
