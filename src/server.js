import { assertSecrets, loadConfig } from "./config.js";
import { createContext } from "./context.js";
import { createApp } from "./http/app.js";

const cfg = loadConfig();
assertSecrets(cfg);
const ctx = createContext(cfg);
const app = createApp(ctx);
const server = app.listen(cfg.port, () => ctx.logger.info("api listening", { port: cfg.port }));
const stop = () => server.close(() => process.exit(0));
process.on("SIGTERM", stop);
process.on("SIGINT", stop);
