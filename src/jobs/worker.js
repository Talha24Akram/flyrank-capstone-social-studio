/** Durable worker loop. All state lives in SQLite, so killing and restarting it loses nothing:
 *  an entry claimed by a dead worker keeps status 'publishing' with an expiring lease, and is re-claimed. */
export function createWorker(ctx, { pollMs = ctx.cfg.workerPollMs } = {}) {
  let running = false, timer, passes = 0;
  const { publishService, logger } = ctx;

  async function pass() {
    const results = await publishService.tick();
    if (++passes % 10 === 0) await publishService.reconcile();
    return results;
  }
  async function loop() {
    if (!running) return;
    try { await pass(); } catch (e) { logger.error("worker pass crashed", { error: e.message }); }
    timer = setTimeout(loop, pollMs);
  }
  return {
    pass,
    start() { if (running) return; running = true; logger.info("worker started", { pollMs }); loop(); },
    stop() { running = false; clearTimeout(timer); },
  };
}
