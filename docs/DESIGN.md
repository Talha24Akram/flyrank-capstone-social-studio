# Design

## Goal
Take one campaign (name, summary, hero image, optional schedule) and publish it to Instagram and X:
one correctly sized image and one platform-tailored caption each, exactly once per platform, even when
workers crash, platforms time out or rate-limit, and clients double-click.

## Honest note about the "fake platform"
The brief mentions a provided starter (`starters/challenge-5-social/`). It was not available to me, so this
repo ships its own stand-in in `src/fake-platform/` that simulates: OAuth token issue/refresh, 429 +
`Retry-After`, `Idempotency-Key` de-duplication, dropped responses (timeouts), random failures, and
HMAC-signed delivery webhooks. Adapters talk to it through one small HTTP client, so pointing them at another
base URL / webhook secret is configuration, but request shapes could differ from the official one.

## Layers
```
http (routes, validation, error mapping)
  -> services (campaign, publish, webhook, accounts)  <- business rules
       -> domain (image variants, caption composer, token vault, clock)  <- pure logic
       -> repositories (SQL only)  -> db (node:sqlite, migrations)
       -> adapters (SocialPublisher implementations) -> fake platform over HTTP
jobs/worker.js : polls the DB, claims due entries with a lease, calls services
```

## Data model (SQLite, WAL)
- `campaigns(id, name, summary, brand_voice, hero_path, subject_*, idempotency_key UNIQUE, created_at)`
- `social_post_entries(id, campaign_id, platform, caption, image_path, status, idempotency_key UNIQUE,
  scheduled_at, next_attempt_at, lease_until, attempts, external_id, last_error, ...)`
  with `UNIQUE(campaign_id, platform)` — a campaign can never have two entries for one platform.
  Status machine: `queued -> publishing -> published | failed` (a 429 or transient error sends it back to `queued`).
- `accounts(platform PK, access_token_enc, refresh_token_enc, expires_at)` — AES-256-GCM, random 12-byte IV per value.
- `webhook_events(event_id PK)` — replay protection.
- `settings(key, value)` — holds the clock offset used to "advance time" in demos and tests.

## No double-posts (three independent layers)
1. DB: unique `(campaign_id, platform)`; publishing twice only re-reads the same rows.
2. Worker claim: single atomic `UPDATE ... WHERE status='queued' AND due` sets `publishing` + a lease.
   A crashed worker's lease expires and the entry is re-claimed.
3. Platform call: every call carries `Idempotency-Key = entry.idempotency_key`; a re-sent request after a
   timeout/crash returns the original post instead of creating another.

## Rate limits
Adapter turns HTTP 429 into `RateLimitedError(retryAfterSeconds)`. The worker does not sleep in-process; it
stores `next_attempt_at = now + Retry-After` and releases the entry, so the wait survives restarts.
Other transient failures use exponential backoff with jitter, max 5 attempts, then `failed`.

## Delivery webhook
`POST /webhook/social-delivery`, `X-Signature: sha256=<hex HMAC-SHA256(raw body, WEBHOOK_SECRET)>`,
constant-time compare. Bad/missing signature -> 400 and no state change. Valid -> entry becomes
`published` / `failed`. Repeated `event_id` is a no-op. If a webhook is lost, a reconcile sweep polls the platform.

## AI
Not used. Captions are composed deterministically from shared fragments (brand voice + platform rules +
content summary), so there is no model cost to track. (See BUILDLOG.md.)
