import { AuthError, PermanentPublishError, RateLimitedError, TransientPublishError } from "../domain/errors.js";

/**
 * SocialPublisher: the contract every platform adapter fulfils.
 *   platform: 'instagram' | 'x'
 *   publish({ caption, image: Buffer, idempotencyKey, accessToken }) -> { externalId, status }
 *   getStatus({ externalId, accessToken }) -> { status: 'processing'|'published'|'failed' }
 * Adapters never touch the database or the token vault; they translate HTTP into typed errors:
 *   RateLimitedError(retryAfterSeconds) | AuthError | TransientPublishError | PermanentPublishError
 */
export class SocialPublisher {
  get platform() { throw new Error("not implemented"); }
  async publish() { throw new Error("not implemented"); }
  async getStatus() { throw new Error("not implemented"); }
}

export function parseRetryAfter(value, fallback = 30) {
  if (value == null || value === "") return fallback;
  const n = Number(value);
  if (Number.isFinite(n) && n >= 0) return Math.ceil(n);
  const t = Date.parse(value); // HTTP-date form
  if (!Number.isNaN(t)) return Math.max(0, Math.ceil((t - Date.now()) / 1000));
  return fallback;
}

/** Shared HTTP plumbing so the two adapters only differ in request/response shape. */
export class HttpPublisher extends SocialPublisher {
  constructor({ baseUrl, timeoutMs = 5000, fetchImpl = fetch }) {
    super();
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.timeoutMs = timeoutMs;
    this.fetch = fetchImpl;
  }

  async call(method, path, { token, headers = {}, body } = {}) {
    let res;
    try {
      res = await this.fetch(this.baseUrl + path, {
        method,
        headers: { "content-type": "application/json", authorization: `Bearer ${token}`, ...headers },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (e) {
      // timeout / reset / refused: the request may or may not have been processed -> retry with the SAME idempotency key
      throw new TransientPublishError(`network: ${e.name === "TimeoutError" ? "timeout" : e.cause?.code || e.message}`);
    }
    if (res.status === 429) throw new RateLimitedError(parseRetryAfter(res.headers.get("retry-after")));
    if (res.status === 401 || res.status === 403) throw new AuthError(`auth rejected (${res.status})`);
    if (res.status >= 500 || res.status === 408) throw new TransientPublishError(`platform ${res.status}`);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new PermanentPublishError(`platform ${res.status}: ${data.error || "rejected"}`);
    return { data, replayed: res.headers.get("idempotent-replayed") === "true" };
  }

  async getStatus({ externalId, accessToken }) {
    const { data } = await this.call("GET", `/v1/posts/${encodeURIComponent(externalId)}`, { token: accessToken });
    return { status: data.status };
  }
}
