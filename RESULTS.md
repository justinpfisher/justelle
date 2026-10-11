# Justelle PoC — execution record (2026-10-10, Toronto)

**Scope:** Compare Cloudflare Workers/D1/R2 + managed Firebase Authentication against integrated Firebase Auth/Firestore/Storage. Entirely synthetic data. No cloud accounts, spending or production changes authorised or used.

## Measured outcomes

| Acceptance condition | Cloudflare local test | Firebase local test | Confidence |
|---|---|---|---|
| Private persistent session | Auth verifier tested; actual session not tested | Firebase `browserLocalPersistence` configured; device/browser test prepared but not run | **Open** |
| Two people see same discussion | PASS in local D1/Worker API simulation | Rules/SDK test written; emulator unavailable | **Partially demonstrated** |
| AI-style suggestion cannot overwrite agreed decision | PASS for proposed/2-approval/locked workflow (mock suggestion, not AI call) | Rules/test written; emulator unavailable | **Partially demonstrated** |
| Direct-file denial for outsider | PASS against simulated private R2 and authorised Worker API | Storage rules/test written; emulator unavailable; token URLs are a further production risk | **Partially demonstrated** |
| Independently restorable export | PASS: JSON + synthetic image restored into fresh SQLite/file directory | Export/restore test written but emulator unavailable | **Partially demonstrated** |
| Production-grade mobile Safari and private media | Not tested | Not tested | **Open** |
| Live vendor integration/cost evidence | Not tested | Not tested | **Open** |

**Executed:** `node --test tests/cloudflare.test.mjs` — 5/5 passing, no external dependencies. This executes Worker request handlers and signed test JWT validation against local SQLite and R2 lookalike adapter, not Cloudflare workerd. Firebase's official emulator and browser runs could not be executed because the test environment cannot fetch npm dependencies.

**Immediate disposition:** Neither stack qualifies for production on this evidence. Treat Cloudflare as provisional stronger portability (standard SQL and private proxy), Firebase as provisional simpler realtime/browser implementation. Actual implementation effort and privacy must be proven using vendor emulators and hosted tests before selection.
