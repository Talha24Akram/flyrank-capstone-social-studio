# BUILDLOG — how this was built, honestly

**Who wrote the code:** Claude Code (an AI coding agent) wrote this repository on my behalf, working autonomously in my
environment; I (Talha) gave the brief and the direction ("do the internship work on my behalf", pick the capstone, use
Docker/GitHub accounts) and did not write the code line by line. I am submitting it as my work and I'm able to explain
the design in [`docs/DESIGN.md`](docs/DESIGN.md), but this log exists so nobody has to guess.

**AI inside the product:** none. Captions are deterministic; nothing calls an LLM at runtime, so there is no model cost to report.

## Phases (matches the commit history)
1. **Design** — read the brief, chose SQLite (`node:sqlite`) + Express 5 + zod + sharp, wrote `docs/DESIGN.md` first.
   Key decisions: leased claims instead of in-process timers; platform `Idempotency-Key`; 429 stored as `next_attempt_at`
   (durable); status changes driven by the signed webhook; shared advanceable clock for demos.
2. **Content** — image variants with safe-zone crop (+ contain fallback) and the caption composer built from shared fragments.
3. **Publishing** — `SocialPublisher` + two adapters, encrypted token vault, fake platform, API, durable worker.
4. **Reliability** — probe tests (double publish, 429, mid-batch crash, races, backoff, reconcile), then webhook/API/security tests.
5. **Demo prep** — `npm run demo`, real multi-process run, crash probe with a killed worker, plaintext-token scan, dashboard screenshot, docs.

## What was checked, and how
- 29 automated tests (`npm test`).
- Real three-process run (`npm start`, `npm run seed`, `npm run demo`): all checks pass; the crash probe killed a worker
  mid-batch with `CRASH_AFTER_PLATFORM_CALL=1` and a restart produced no duplicates (captures in `evidence/`).
- Bugs found while testing and fixed: a test that wrongly assumed untouched entries were still claimable right after a
  crash (a tick leases the whole batch; they are picked up after the lease expires); the demo initially compared the
  wall clock with the app clock, which made the 429 wait look like ~3600 s after a clock advance.

## What was NOT done / not verified
- The official fake-platform starter was unavailable, so a stand-in was built (see README). Compatibility with the official one is untested.
- Docker files are unverified (no Docker daemon was running on the build machine).
- No stretch goals.
