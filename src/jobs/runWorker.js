import { assertSecrets, loadConfig } from "../config.js";
import { createContext } from "../context.js";
import { createWorker } from "./worker.js";

const cfg = loadConfig();
assertSecrets(cfg);
// Chaos hook for the crash-recovery probe: die right after the platform accepted a post,
// before we wrote that fact down. Restarting the worker must NOT create a second post.
const hooks = cfg.crashAfterPlatformCall
  ? { afterPlatformCall: () => { console.error(JSON.stringify({ level: "error", msg: "CRASH_AFTER_PLATFORM_CALL: exiting abruptly" })); process.exit(137); } }
  : {};
const ctx = createContext(cfg, { hooks });
const worker = createWorker(ctx);
worker.start();
const stop = () => { worker.stop(); process.exit(0); };
process.on("SIGTERM", stop);
process.on("SIGINT", stop);
