# Justelle infrastructure PoC — evidence and limits

**Date:** October 10, 2026 (America/Toronto). **Scope:** strictly fictional two-member room, synthetic landscape image, no production deployment, no real personal content, no provisioned vendor accounts, no paid service activation.

## Acceptance results

| User requirement | Cloudflare Worker + D1/R2 + Firebase Auth | Firebase integrated Auth/Firestore/Storage |
|---|---|---|
| Signed access & separation | PASS — RSA-signed fictional JWTs validated in local Worker handler; missing, expired and third-party tokens denied | PASS — authenticated/outsider Firestore and Storage rules exercised in official Firebase emulator |
| Two fictional members share the same messages | PASS — local Worker routes backed by Node SQLite | PASS — official Firestore emulator from two separate simulated Auth contexts |
| Proposals cannot silently overwrite agreed decisions | PASS — one approval leaves proposal open; two distinct approvals lock it; no edit route exists | PASS — Firestore Rules reject one-person locking, vote spoofing and edits to locked decisions |
| Private photo direct access and overwrites | PASS — local R2-compatible private adapter; unauthenticated/outsider requests denied, private headers set | PASS — official Storage Rules emulator denied outsider/nonmember and unauthenticated reads, forbidden format, and overwrite; explicit `resource == null` |
| Independently restorable export | PASS — checksummed JSON/media → clean SQLite and file directory | PASS — same provider-neutral archive restored without Firebase |
| Stay signed in after browser reopen | **Not yet tested with actual Cloudflare Worker and signed production-like Auth** | **PASS:** two disposable real-emulator accounts; 390px Chromium signed-in persistence after reload and full browser-profile relaunch; not iPhone Safari |
| Live model-generated proposals | Not performed; fictional AI-style text tests the state transition | Not performed; fictional AI-style text tests the state transition |
| Real iPhone Safari or deployed, authenticated media | Not performed | Not performed |
| Live monthly vendor bill / real latencies | Not measured: no cloud accounts used | Not measured: no cloud accounts used |

**Executed Cloudflare tests:** `node --test tests/cloudflare.test.mjs` → **5/5 PASS** (local SQLite, local object adapter, real signed test JWTs; *not* actual workerd or live R2). **Executed Firebase tests:** `npm run test:firebase` in GitHub Actions against official Firestore and Storage emulators → **4/4 PASS** after deliberate negative-case corrections. Firebase's original Storage write rule had to be tightened to check both the approved membership record and `resource == null`; test isolation was corrected to prevent shared emulator fixtures contaminating results. **Browser acceptance PASS** in successful GitHub Actions run [38109886272](https://github.com/justinpfisher/justelle/actions/runs/38109886272), confirming separate accounts, shared messages, two approvals, session after reload and browser relaunch at a 390px viewport. No real iPhone testing was performed.

## Development and maintenance comparison

This is a comparison of *implementation footprint and test behaviour*, not measured engineering hours or a professional developer quotation. Shared UI, restoration tool and browser harness serve both candidates. Cloudflare-specific API and verifier: about **179 lines** of application code, plus the SQL schema. Firebase-specific Security Rules: **81 lines**, plus a small ~28-line SDK adapter. Firebase has less bespoke server code and built-in live updates, but we encountered rules nuances and a provider-specific live data format. Cloudflare has ordinary SQLite records and a self-controlled media proxy, but requires continuous maintenance of its Worker endpoints and external authentication/JWT-verification boundary. Either requires production access review, backup automation and operating controls.

## Budget (CAD, not invoices)

At 2026-10-09 indicative US$1 ≈ C$1.43, Cloudflare Workers Paid US$5 is roughly **C$7.15/month**, plus any usage above included D1/R2 allowances. A light Firebase integrated deployment may cost **C$0** for platform usage when staying within included allowances, but **Blaze billing registration is required for Firebase Cloud Storage**. Managed Firebase Authentication for two users can usually remain within no-cost usage allowances in either architecture. Illustrative combined running costs including moderate separately billed AI usage: Cloudflare **C$12–35/month**; Firebase **C$5–30/month**. Neither amount is measured; actual costs require isolated, billing-authorized hosted trials. Existing iCloud/OneDrive subscriptions need not be duplicated, and OneDrive backup has not been implemented in this PoC.

## Qualification and next gate

Keep PR in draft; do not deploy private material. Test actual workerd/R2 and signed real identity tokens with fictional data if account access becomes available, verify session persistence and revocation on both iPhones, deny direct file URL access with real hosted storage, and restore an encrypted backup outside the provider. A deterministic AI-style test proves decision integrity only; a real AI connector, moderation/privacy decisions and usage caps remain for a production build. **Neither candidate is production-qualified on emulator evidence alone.**