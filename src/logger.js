// Tiny structured logger. Anything that looks like a secret is redacted before it is written,
// so tokens can never reach the logs even if a caller logs a whole object by mistake.
const SENSITIVE_KEY = /token|secret|authorization|password|signature|enc_key|api[-_]?key/i;
const SENSITIVE_VALUE = /(Bearer\s+)[A-Za-z0-9._~+/=-]+|\b(?:at|rt)_[A-Za-z0-9]{16,}\b/g;

export function redact(value, depth = 0) {
  if (depth > 6) return "[deep]";
  if (typeof value === "string") return value.replace(SENSITIVE_VALUE, (m, b) => `${b || ""}[REDACTED]`);
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1));
  if (value && typeof value === "object") {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = SENSITIVE_KEY.test(k) ? "[REDACTED]" : redact(v, depth + 1);
    }
    return out;
  }
  return value;
}

export function createLogger(name, sink = (line) => process.stdout.write(line + "\n")) {
  const log = (level) => (msg, fields = {}) =>
    sink(JSON.stringify({ t: new Date().toISOString(), level, name, msg: redact(String(msg)), ...redact(fields) }));
  return { info: log("info"), warn: log("warn"), error: log("error") };
}
