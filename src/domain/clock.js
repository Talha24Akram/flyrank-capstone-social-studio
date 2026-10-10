// The app's notion of "now" = real time + an offset stored in the DB.
// Advancing the offset lets demos/tests skip a 30 s Retry-After or a schedule without sleeping,
// and every process (api, worker) sees the same time because the offset lives in SQLite.
export function createClock(db) {
  const get = db.prepare("SELECT value FROM settings WHERE key='clock_offset_ms'");
  const set = db.prepare("UPDATE settings SET value=? WHERE key='clock_offset_ms'");
  return {
    offsetMs: () => Number(get.get()?.value ?? 0),
    now() { return Date.now() + this.offsetMs(); },
    advance(seconds) { set.run(String(this.offsetMs() + Math.round(seconds * 1000))); return this.now(); },
  };
}
