# EVIDENCE

One proof per box of the brief's §6 checklist. Everything below was produced on 2026-10-10 against **my own stand-in fake platform**
(the official starter was not available — see README "Honest notes"). Unit/integration tests run in-process
(`npm test`, 29 passing); the demo and crash probes were run against the real three-process stack (`npm start` + `npm run seed`).
Raw captures are in [`evidence/`](evidence/).

## Content generation

**Image variants: dimensions, aspect ratio, subject in safe zone — a test asserts the dimensions**
- `test/images.test.js` — "Instagram variant is exactly 1080x1080 and X is exactly 1600x900", "subject stays inside the safe zone on every platform", "a subject too wide for a crop falls back to contain (nothing cut off)".
- Real artifacts served by the API: [`evidence/sample-instagram-1080x1080.jpg`](evidence/sample-instagram-1080x1080.jpg), [`evidence/sample-x-1600x900.jpg`](evidence/sample-x-1600x900.jpg); the demo re-reads them over HTTP with `sharp` (step 1 below: `{"instagram":"1080x1080","x":"1600x900"}`).

**Captions are platform-aware, composed from shared + platform fragments, no duplicated prompts**
- `src/domain/captions/fragments.js` holds the shared brand voices + per-platform rules; `composer.js` renders both from one spec. No AI prompts exist (AI is not used).
- Real output (demo step 1): Instagram = hook + summary + CTA + 5 hashtags + emoji; X = hook + summary + 2 hashtags, ≤ 280 chars. See `evidence/demo-run.txt` and `evidence/dashboard.png`.
- Tests: `test/captions.test.js` (4 passing).

## Adapter layer

**One `SocialPublisher` interface, ≥ 2 implementations; the app depends on the interface**
- `src/adapters/SocialPublisher.js` (interface + shared HTTP behaviour), `fakeInstagram.js`, `fakeX.js`, picked via `registry.js`. `PublishService` only calls `publisher.publish(...)`; grep shows no platform name inside `src/services/`.

**OAuth tokens encrypted at rest, random IV, never logged or committed**
- AES-256-GCM, format `v1.<iv>.<tag>.<ciphertext>`, fresh 12-byte IV per encryption, AAD bound to the account (`src/domain/tokenVault.js`). Test: "vault: round-trips, uses a fresh random IV, binds to the account, rejects tampering".
- Probe 6 on the real stack (`evidence/probe6-no-plaintext.txt`):
```
data/studio.sqlite: at_/rt_ hits=0 Bearer-hits=0
data/studio.sqlite-wal: at_/rt_ hits=0 Bearer-hits=0
logs/stack.log: at_/rt_ hits=0 Bearer-hits=0
logs/worker-crash.log: at_/rt_ hits=0 Bearer-hits=0
logs/worker-restart.log: at_/rt_ hits=0 Bearer-hits=0
accounts rows (values truncated for display):
{"platform":"instagram","access_token_enc":"v1.VYdP4Ka1H-7JLcAo.HPlnqCJiIoBj6v…","refresh_token_enc":"v1.jz4R5XOZQmxXyBYV.FiXv_JkjXa3Fnp…"}
{"platform":"x","access_token_enc":"v1.1vqurWLcmgOlkhsL.fKoZ8tigKDs_W_…","refresh_token_enc":"v1.4ghUEaNqQsvBzWOn.9rT3e76HYUNYIo…"}
```

- Test: "probe 6: no plaintext token in the database file or the logs", "logger redacts secrets even when a caller logs a whole object". `.env` is git-ignored; only `.env.example` is committed.

## Reliability

**Idempotent publishing (publish twice / retry after timeout → exactly one post)**
- Test "probe 1: publish twice, then retry after a dropped response -> exactly one post per platform".
- Live (demo step 3): 10 parallel `POST /campaigns/:id/publish` → all 200; platform holds exactly 1 post per platform; same `Idempotency-Key` on create returns the same campaign.

**429 + Retry-After honoured**
- Test "probe 2: 429 with Retry-After: 30 waits 30s (durably), then succeeds".
- Live (demo step 4): `released to queued, next attempt in ~30s (Retry-After honoured)`, `not retried early`, then published after the clock advanced 31 s.

**Durable scheduling; crash mid-batch resumes without double-posting**
- Tests: "probe 3: worker dies mid-batch (after platform accepted, before saving) -> restart creates zero duplicates", "two workers on one database never claim the same entry", "scheduled campaigns do nothing until their time; advancing the clock releases them".
- Live (real processes):
```
# Real processes (npm start stack; worker replaced by one started with CRASH_AFTER_PLATFORM_CALL=1, which exits 137
# right after the platform accepted a post and before the result is saved), then restarted without the flag.
campaign=cmp_f648e09e68398f07
--- after crash (worker alive? 0)
{"t":"2026-10-10T19:40:02.218Z","level":"info","name":"studio","msg":"worker started","pollMs":500}
{"level":"error","msg":"CRASH_AFTER_PLATFORM_CALL: exiting abruptly"}
instagram:publishing:ext=null  x:published:ext=post_2c569c66e488bb2d9e602894
platform posts for campaign:
x post_2c569c66e488bb2d9e602894
# clock advanced 31s (lease expiry), worker restarted
--- after restart
instagram:published:attempts=2  x:published:attempts=1
posts on platform: 2 (x,instagram) | total=6
```

## Status & trust

**Webhooks signature-verified; forged/modified → 400**
- Tests: "probe 4: forged webhook -> 400 and status unchanged; valid webhook -> published", "a tampered body with a signature for the original body is rejected".
- Live (demo step 5): `forged signature -> HTTP 400`, `status unchanged after forged webhook`, `valid signature -> HTTP 200`, `status is now published`.

**Status transitions queued → publishing → published | failed, stored in a SocialPostEntry-shaped record**
- Table `social_post_entries` (`src/db/migrations/001_init.sql`); `entries.applyDelivery` is the only place a delivery result changes status; test "end to end: queued -> publishing -> published via signed delivery webhook" and "replayed event_id is a no-op; failed delivery marks the entry failed".
- Green dashboard: [`evidence/dashboard.png`](evidence/dashboard.png).

## Tests & documentation

**Automated tests cover images, duplicate-publish, forged webhook, rate limit** — full run (`npm test`):
```
✔ validation: bad input is always a 4xx with details, never a 500
✔ creating a campaign yields correctly sized images and different captions per platform
✔ uploaded images work, and Idempotency-Key on create returns the same campaign
✔ publish is idempotent over HTTP and the dashboard JSON reflects the state
✔ captions differ per platform and both respect their length caps
✔ X caption is trimmed to 280 chars for very long summaries and keeps its hashtags
✔ brand voice is shared: changing it changes both platforms
✔ instagram hashtag count follows the rule table
✔ Instagram variant is exactly 1080x1080 and X is exactly 1600x900
✔ subject stays inside the safe zone on every platform
✔ a subject too wide for a crop falls back to contain (nothing cut off)
✔ unknown platform is rejected
✔ probe 1: publish twice, then retry after a dropped response -> exactly one post per platform
✔ probe 2: 429 with Retry-After: 30 waits 30s (durably), then succeeds
✔ probe 3: worker dies mid-batch (after platform accepted, before saving) -> restart creates zero duplicates
✔ two workers on one database never claim the same entry
✔ transient 503s back off exponentially, then permanent failure is recorded after max attempts
✔ end to end: queued -> publishing -> published via signed delivery webhook
✔ scheduled campaigns do nothing until their time; advancing the clock releases them
✔ lost webhook: reconcile polls the platform and settles the entry
✔ vault: round-trips, uses a fresh random IV, binds to the account, rejects tampering
✔ probe 6: no plaintext token in the database file or the logs
✔ logger redacts secrets even when a caller logs a whole object
✔ expired token is refreshed transparently; a rejected token triggers one refresh-and-retry
✔ Retry-After parsing: seconds, HTTP-date, junk
✔ probe 4: forged webhook -> 400 and status unchanged; valid webhook -> published
✔ a tampered body with a signature for the original body is rejected
✔ replayed event_id is a no-op; failed delivery marks the entry failed
✔ late 'published' beats a locally recorded failure; unknown entries are ignored; bad payloads are 400
```

**README + diagram + setup; submission-pack files present** — `README.md`, `capstone.yaml`, `EVIDENCE.md`, `BUILDLOG.md`, `.env.example`, `LICENSE` (MIT), `docs/DESIGN.md`.

## Full scripted demo (`npm run demo` against the running stack)

```

== 1. create campaign -> per-platform images and captions
  PASS  created (HTTP 201)
  instagram caption: Psst, guess what: Demo mv2st0xy ✨ 🚀 ⏎  ⏎ Open studio day: free workshops, coffee, and a first look at our new prints. ⏎  ⏎ Tap the link in bio. ⏎  ⏎ #Demomv2st0xy #Open #Studio #Free #Workshops
  x caption        : Psst, guess what: Demo mv2st0xy ⏎ Open studio day: free workshops, coffee, and a first look at our new prints. #Demomv2st0xy #Open
  PASS  captions differ per platform
  PASS  x caption within 280 chars (128)
  PASS  image variants {"instagram":"1080x1080","x":"1600x900"}

== 2. schedule for +1h, advance the shared clock, worker publishes
  PASS  scheduled (HTTP 200) -> {"instagram":"queued","x":"queued"}
  PASS  still queued before its time
  PASS  published after clock advance -> {"instagram":"published","x":"published"}

== 3. idempotency hammer: 10 parallel publishes + same Idempotency-Key re-create
  PASS  all 10 publish calls answered 2xx (200)
  PASS  re-sent create with the same key returns the same campaign
  PASS  platform holds exactly 1 post per platform for this campaign (2)

== 4. 429 with Retry-After: 30 -> wait -> retry -> success
  PASS  released to queued, next attempt in ~30s (Retry-After honoured)
  PASS  not retried early
  PASS  retried after the wait and published
  PASS  exactly 1 post on the platform

== 5. webhook: forged -> 400 (status unchanged), valid -> published
  PASS  entry is 'publishing' with platform id post_971ed9c351724dd74db4ffaf
  PASS  forged signature -> HTTP 400
  PASS  status unchanged after forged webhook
  PASS  valid signature -> HTTP 200
  PASS  status is now published

== 6. summary
  status counts: {"published":4,"queued":2}
  dashboard: http://localhost:3000/dashboard

DEMO OK - all checks passed
```
