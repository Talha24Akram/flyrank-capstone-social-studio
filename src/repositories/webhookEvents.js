export function createWebhookEventRepo(db) {
  const ins = db.prepare("INSERT OR IGNORE INTO webhook_events (event_id, entry_id, received_at) VALUES (?,?,?)");
  return {
    /** true if this event_id is new, false if we already processed it (replay) */
    record: (eventId, entryId, now) => ins.run(eventId, entryId, now).changes === 1,
  };
}
