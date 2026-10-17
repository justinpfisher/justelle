# Justelle infrastructure comparison: fictional-only proof of concept

**Status: Cloudflare-compatible local tests 5/5 PASS; official Firebase emulator tests 4/4 PASS; headless Chromium mobile-viewport interaction/persistence test PASS; real iPhone/hosted tests NOT RUN.** This bundle is not a production app and should not be deployed to `justelle.life` or used with personal content. It requires no cloud accounts, bills or API credentials to run its local tests.

## Purpose

Two alternatives implement the same contract:

1. **Cloudflare Worker + D1 + R2 + Firebase Authentication:** a private API, portable SQLite-based records, selected files in private object storage, JWT verification against Firebase signing keys, and authorisation for exactly two approved accounts. Runs locally in Node with SQLite and a D1/R2 compatibility test harness; no live Cloudflare account is configured.
2. **Integrated Firebase:** Firebase Authentication, Firestore, and Firebase Storage protected by Security Rules. Tests run in the official Firebase emulators through GitHub Actions: **4/4 PASS**. The source container could not download dependencies directly, so CI provided the execution environment. Firebase Storage requires a billing-enabled Blaze project for real Cloud Storage in 2026, even if usage falls under free allowances.

Both use **fabricated** `fictional-a`, `fictional-b` and `fictional-room`, fictional conversation texts, and an entirely synthetic 160×100 PNG landscape. No private family photographs, trips, account details or passwords are in this code. The browser seeder generates ephemeral passwords in a temporary file at run time; it refuses non-local emulators.

## Current evidenced result

`node --test tests/cloudflare.test.mjs` runs five passing tests, including: properly signed test JWT verification with tampering/expiry rejection; two distinct fictional users sharing messages; one person's approval not locking a proposal; denied unauthenticated/outside-member media reads; and a checksum-verified portable JSON export restored **without either provider** into SQLite plus an image file. This uses **actual Node SQLite** and a local D1/R2 **compatibility simulation**, **not** a Wrangler runtime or live R2 service.

The Firebase tests under `tests/firebase.test.mjs` ran against official Firestore and Storage emulator Security Rules (**4/4 PASS**). The browser probe in `tests/browser.mjs` also passed with two separate emulator accounts at a 390px Chromium viewport, preserving sign-in after both reload and a full browser-profile relaunch. This does **not** establish real iPhone Safari persistence.

There is **no live AI provider request** in either candidate. A fabricated AI-style suggestion exercises the proposal/approval mechanism. Both designs would need a server-side AI adapter and usage controls before a real AI could respond.

## Run local tests (requires internet for initial npm / emulator installation)

From the `poc` directory:

```sh
npm install --no-audit --no-fund
npm run test:cloudflare
npm run test:firebase
npx playwright install chromium
npm run test:firebase:browser
```

Dependencies: Node 22+, Java 21+, npm, browser for the headless test. Running `npm run test:firebase` starts **local-only** Firestore and Storage emulators. `npm run test:firebase:browser` starts Auth, Firestore and Storage emulators, seeds two disposable accounts with custom claims, opens a mobile-size Chromium browser for each, and tests persistent sign-in, shared messages, approval rules and browser reopening. It uses no real Firebase project, domain or secrets. Access the manual Vite app only after emulator setup; the default `?backend=firebase` uses emulator-only configuration.

The Cloudflare browser adapter is **not demonstrated live**: locally issued Firebase Auth emulator tokens are unsigned, while the Worker correctly requires verifiable RSA-signed production ID tokens. Its server behaviour is tested with short-lived RSA-signed synthetic tokens in the Node harness. A live, isolated Firebase Auth test tenant and Cloudflare project would be required for an end-to-end hosted comparison.

## Data model and portability

Messages, proposed/locked decisions, approvals and selected files export to `justelle-poc-v1` JSON with base64 image bytes and SHA-256 checksums. `common/restore.mjs` rebuilds records into a clean SQLite database and restores bytes as ordinary files. The Cloudflare candidate stores permanent `person-a` / `person-b` IDs separately from Firebase UIDs. The Firebase export maps Auth UIDs to canonical person IDs during extraction; a real implementation should store that mapping securely and immutably rather than embed it in code.

The exporter is suitable **only for small fictional fixtures**. Production requires bounded asynchronous backups, archive encryption, access audit, delete/retention policy, large-media streaming, recovery drills and cross-provider import tests, not inline base64 exports of years of photos.

## Security boundaries and unresolved checks

- Member-only server endpoints and Firebase Security Rules are planned. Real public object endpoints must be disabled; R2 buckets must remain private.
- Firebase Storage SDK `getBytes` uses authenticated Security Rules. **Never expose long-lived `getDownloadURL` tokens** as private access controls: possession of a download token can make a file accessible without the normal Auth Rules check. A stricter server-side media proxy is an alternative for production.
- Firebase web `browserLocalPersistence` is configured, but it is not evidence that a particular iPhone's installed Home Screen web app remains signed in after days or OS eviction. Real device tests are mandatory.
- Firebase Security Rules can prohibit direct client changes to locked decisions. Cloudflare's Worker API similarly has no edit route for a locked decision. Future admin or migration scripts must also preserve this invariant.
- Full AI-generated responses, cloud billing, OneDrive backups, sign-in revocation, expired sessions, multi-week connectivity and production policy need separate testing.
- This bundle contains no production environment configuration and intentionally fails closed if Cloudflare's member mapping has not been configured.

## Current decision gate

Do **not** choose a backend from a local mock test alone. Run the official Firebase emulator suite and, if possible, Wrangler's local workerd/D1/R2 simulator, then conduct separate, no-personal-data hosted tests on isolated free-tier projects **only after account/billing consent**. Finally run on both iPhones, test a fresh-device sign-in once, close and reopen the app, test session expiry/revocation, denial from an unknown account, a direct media URL and restoration of encrypted exports. Choose based on measured development effort and real monthly logs, not merely theoretical pricing.

## Cost assumptions (CAD)

Using about **C$1.43 per US$1** (October 9, 2026 Reuters close), the Cloudflare Workers paid platform fee of US$5 is roughly **C$7.15/month**; Cloudflare's no-charge allowances for D1 (5 GB) and R2 (10 GB) can cover a small PoC, with storage above that billed separately. Firebase Firestore's free allowance is 1 GiB, 50,000 reads and 20,000 writes per day. A new Firebase Cloud Storage bucket needs the Blaze billing plan, though free allowances may still cover very small use. App-wide AI usage costs are additional. Rough *planning* totals for two users after hosting are C$5–30/month for Firebase and C$12–35/month for Workers + managed Auth, with the low end assuming little research or media storage. They are **not actual measured invoices** and exclude taxes, service increases and maintenance. Before provisioning any service, set spend controls and budgets.

Vendor references: https://developers.cloudflare.com/workers/platform/pricing/ ; https://developers.cloudflare.com/d1/platform/pricing/ ; https://developers.cloudflare.com/r2/pricing/ ; https://firebase.google.com/pricing ; https://firebase.google.com/docs/storage/faqs-storage-changes-announced-sept-2024 ; https://firebase.google.com/docs/auth/web/auth-state-persistence ; https://firebase.google.com/docs/storage/web/download-files

## Verified CI evidence

[Successful GitHub Actions run 38109886272](https://github.com/justinpfisher/justelle/actions/runs/38109886272): 5/5 Cloudflare-compatible local checks, 4/4 official Firebase emulator checks, and passed Chromium browser interaction/persistence checks. Cloudflare was not run under actual workerd, and no actual iPhone, live API model, production user account or hosted storage was qualified.
