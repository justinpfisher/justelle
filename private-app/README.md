# Justelle private shared-life pilot (fictional / local)

This is the first working implementation for GitHub Issue #4, developed on branch feat/private-shared-app-v1 and reviewed in PR #5. It is not deployed and must not be used with actual personal data. The existing public homepage and domain remain unchanged. The Firestore/Storage foundation was adapted from the working Firebase side of draft PR #2 without merging that comparative PoC.

## Preview the app on your own computer

You will need Node.js 22 or newer, Java 21 or newer, npm and a modern browser. An internet connection is needed for the initial installation and the Firebase emulator download.

1. Download/clone the repository and switch to branch feat/private-shared-app-v1.
2. In Terminal or PowerShell, open the private-app folder.
3. Run:

    npm install --no-audit --no-fund
    npm run pilot

4. Open http://127.0.0.1:5173/ on that computer.
5. The terminal displays two disposable fictional email/password pairs. Open two separate browser profiles (not two tabs of the same profile), then sign in once to each account. The pair can exchange messages, attachments and proposals in real time.
6. Ctrl+C stops all local services and removes the temporary credential file. The emulator content is disposable.

The script uses local Firebase Authentication, Firestore and Storage emulators only, plus a protected local mock AI gateway. No accounts, real email invites, live Firebase cloud services, paid model API or domain change is involved. Browser reopening within the same profile retains sign-in while the emulator remains running. It cannot establish actual installed iPhone Safari/Home Screen persistence, which must be tested separately after an authorised hosted trial.

## Current experience

- Two individual fictional member accounts share a real-time conversation and attached images. **In the conversation, Enter sends and Alt+Enter inserts a new line** (Shift+Enter also remains available for line breaks). Enter continues to insert a newline in proposal and other multi-line editors; the Send button works on touchscreens.
- Image files can be PNG or JPEG; iPhone HEIC/HEIF originals remain intact while the browser attempts to create a separate JPEG preview with heic2any. An unsupported conversion fails without uploading anything. Up to three images per message, each no more than 12 MB, with errors and retry through the message composer.
- Image retrieval uses the authenticated Firebase Storage SDK. No reusable getDownloadURL token link is deliberately generated; a hosted direct URL test remains required.
- The test AI gateway verifies the member's Auth ID token and room membership, then obtains original image bytes and SHA-256 checksums, and passes them through a replaceable provider interface. **The deterministic test provider does not understand image pixels** and does not contact a paid model. AI suggestions are stored as proposals, never decisions.
- Plans use conversational statuses such as **Just a suggestion**, **You said yes. Waiting for [other member] to weigh in**, and **We both said yes**. These are displayed from the current viewer’s perspective; each person's name and agreement time is also shown. Underneath, both people must expressly agree to a proposal before it is locked. Locked versions and approval timestamps are preserved. A change to an agreed plan creates a separate suggestion linked to the original. The AI cannot agree on anyone’s behalf.
- A saved idea progresses through idea, plan, experience and memory. Source messages and their attachments remain separate, recoverable records.
- The browser can export provider-neutral Justelle-memory-v1 JSON, including stable person IDs, conversations, provenance, proposals, approvals, revisions, adventures and original file bytes with SHA-256 digests.
- The independent restore utility verifies checksums and relationships before writing a fresh, ordinary SQLite file plus individual original media files. It does not require Firebase or an AI provider.

## Repeatable automated checks

From the private-app directory:

    npm run test:archive
    npm run test:rules
    npx playwright install chromium
    npm run test:browser

GitHub Actions runs the same commands using Node 22 and Java 21. Check the actual PR #5 Actions run status for the current pass/fail result rather than interpreting committed test source as evidence. The official Firebase Rules emulators are used for access controls; Chromium exercises two independent 390px browser sessions, messages, images, AI replies, approvals, adventure progression, exports and reopen persistence. All accounts, conversations and fixture images are fictional.

## Offline restoration

Export a fictional archive through Adventures / Export fictional archive. Run this from private-app, with a new output directory that does not already exist:

    node memory/restore.mjs /path/to/justelle-fictional-memory.json /path/to/new-restored-folder

The result contains a memory.sqlite database and media files. Both are readable without any Firebase credentials. The archive is **not encrypted**: do not introduce private personal data until an encrypted automated backup, independent durable location, restoration drill and bounded media-export strategy have been installed and verified.

## Protection and launch boundaries

The repository and branches are PUBLIC. No real member identities, credentials, messages, personal images, itineraries or exported private backups belong in this repository, GitHub issue, workflow logs or published assets. The app shell and approved artwork are not secrets; stored records and original images are member-only according to emulator-tested Firebase Security Rules.

Keep this PR unmerged until GitHub Pages publishing paths have been independently verified. Source changes must not accidentally expose the private-app subfolder as live public content. The public homepage, its illustration and CNAME are untouched here.

Before a hosted private launch, establish an owned Firebase project on Blaze billing (Cloud Storage requires Blaze), a separate protected deployment/hostname, two real Auth identities and secure enrolment, a metered server-side vision-capable AI adapter, provider credentials kept outside GitHub, hard request/rate caps and spending alerts, and encrypted independent backups with tested restore. Repeat hosted direct-media, outsider, token replay/revocation, iPhone Safari/Home Screen and actual HEIC/mobile usability checks. No paid service or production user was activated in this pilot.

## Estimated running costs in Canadian dollars

Planning baseline as of October 11, 2026: US$1 = about C$1.43. For two users, 30 AI calls/day (around 900/month), around 3,000 text input tokens and 400 output tokens per call, and 600 pictures at 3 MB each (1.8 GB originals), light-month costs could look like:

| Item | Illustrative CAD/month | Important caveat |
| --- | ---: | --- |
| Firebase Auth, Firestore, hosting, server gateway | C$0–5 | Assuming light use within applicable free quotas; cloud Functions needs billing-enabled Blaze |
| Firebase image storage/traffic | C$0–3 | Eligible new storage buckets offer 5 GB-months and 100 GB/month download free; egress and operations can exceed allowances |
| Replaceable image-capable AI provider | C$1–25 | Model, images, context length, tool/research use and retries can materially change costs |
| Independent encrypted backup destination | C$0–5 incremental | Depends on existing subscription/destination; automation and encryption still need implementing |
| **Estimated light-use total** | **C$1–38 per month** | Not a measured invoice; excludes taxes, domain renewals and substantial use |

For illustration only, using GPT-6 Luna standard text rates of US$0.10 per million input tokens and US$0.50 per million output tokens, the described 900 text calls are around US$0.45 (C$0.64), **before image processing**. GPT-6 Sol at US$2 / US$10 would be around US$9 (C$12.87), before image processing, at the same token counts. This is illustrative model pricing, not a planned vendor lock-in. A personal ChatGPT subscription does not cover separate embedded API use.

Firebase requires billing-enabled Blaze for Cloud Storage even when consumption fits free quotas. Set usage monitoring and an enforceable application-level cap before connecting a paid AI. Billing alerts alone are not hard caps.

Vendor and FX references:
- https://firebase.google.com/pricing
- https://firebase.google.com/docs/storage/faqs-storage-changes-announced-sept-2024
- https://firebase.google.com/docs/projects/billing/firebase-pricing-plans
- https://developers.openai.com/api/docs/pricing
- https://www.reuters.com/business/canadian-dollar-hits-18-month-low-jobs-data-clips-rate-hike-bets-2026-10-09/

All code and recorded synthetic test assets belong to the private pilot directory. Nothing has been deployed to justelle.life.
