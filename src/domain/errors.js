export class AppError extends Error {
  constructor(status, code, message, details) { super(message); this.status = status; this.code = code; this.details = details; }
}
export const badRequest = (m, d) => new AppError(400, "bad_request", m, d);
export const notFound = (m) => new AppError(404, "not_found", m);
export const conflict = (m) => new AppError(409, "conflict", m);

// Thrown by adapters
export class RateLimitedError extends Error {
  constructor(retryAfterSeconds) { super(`rate limited, retry after ${retryAfterSeconds}s`); this.name = "RateLimitedError"; this.retryAfterSeconds = retryAfterSeconds; }
}
export class TransientPublishError extends Error { constructor(m) { super(m); this.name = "TransientPublishError"; } }
export class PermanentPublishError extends Error { constructor(m) { super(m); this.name = "PermanentPublishError"; } }
export class AuthError extends Error { constructor(m) { super(m); this.name = "AuthError"; } }
