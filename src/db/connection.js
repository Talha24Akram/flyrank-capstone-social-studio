import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

export function openDb(file) {
  if (file !== ":memory:") fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec("PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000; PRAGMA foreign_keys = ON; PRAGMA synchronous = NORMAL;");
  return db;
}

// BEGIN IMMEDIATE takes the write lock up front, so two processes can never interleave
// a read-then-write inside a transaction.
export function tx(db, fn) {
  db.exec("BEGIN IMMEDIATE");
  try {
    const r = fn();
    db.exec("COMMIT");
    return r;
  } catch (e) {
    try { db.exec("ROLLBACK"); } catch { /* already rolled back */ }
    throw e;
  }
}
