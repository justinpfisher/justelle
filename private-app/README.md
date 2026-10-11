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
6. **To stop the preview cleanly, type `q` and press Enter in its PowerShell window.** This is recommended on Windows because Ctrl+C through an npm batch process can leave the Java Firestore emulator behind. Ctrl+C remains supported. The runner removes its temporary credential file and stops its child processes; emulator data is disposable.

The script uses local Firebase Authentication, Firestore and Storage emulators only, plus a protected local mock AI gateway. No accounts, real email invites, live Firebase cloud services, paid model API or domain change is involved. Browser reopening within the same profile retains sign-in while the emulator remains running. It cannot establish actual installed iPhone Safari/Home Screen persistence, which must be tested separately after an authorised hosted trial.

## Current experience

- Two fictional members share **Our chat** and can open individual discussions for each named adventure. Every discussion has its own messages, images and associated plans; the original chat message used to create an adventure is preserved and referenced, not moved or duplicated.
- Conversations display **the latest 40 messages at first**, with **Load earlier messages** and **Jump to newest**. Older messages and images remain in the provider-neutral archive, regardless of what's onscreen. Adventures are labelled clearly so users know which topic they're discussing.
- **Enter sends** within a conversation, **Alt+Enter** (or Shift+Enter) inserts a new line. Other multi-line editors behave normally; the Send button remains available for iPhone users. The last selected discussion is remembered on the local device after signing in again.
- Image files can be PNG or JPEG; iPhone HEIC/HEIF originals remain intact while the browser attempts to create a separate JPEG preview with heic2any. An unsupported conversion fails without uploading anything. Up to three images per message, each no more than 12 MB, with errors and retry through the message composer.
- Image retrieval uses the authenticated Firebase Storage SDK. No reusable getDownloadURL token link is deliberately generated; a hosted direct URL test remains required.
- The emulator-only test AI gateway verifies member authentication and room membership, loads **only the active discussion context** and related confirmed plans, and checks original-image SHA-256 digests before passing bytes through a replaceable provider interface. **The deterministic assistant cannot answer factual questions or interpret images**, states that limitation clearly, and makes draft plans **only when explicitly asked**. No external AI API is called.
- Plans appear **within the discussion they concern**, not in an unrelated global list. Human suggestions can be agreed to by both members or passed on by either person. The interface says **Just a suggestion**, **You said yes. Waiting for [other member] to weigh in**, **Not for us**, or **We both said yes**. Who agreed or declined is retained. A new agreed version supersedes an old one in the interface without changing the original record. Competing agreed revisions are surfaced for clarification, never silently resolved by AI.
- An adventure tracks exploring, planning, an experience and eventually a memory. **Its stage is not the same as mutual agreement**, which still requires two explicit confirmations for significant decisions. The source message and all linked attachments remain independent records.
- The browser can export provider-neutral Justelle-memory-v1 JSON, including stable person IDs, conversations, provenance, proposals, approvals, revisions, adventures and original file bytes with SHA-256 digests.
- The independent restore utility verifies checksums and relationships before writing a fresh, ordinary SQLite file plus individual original media files. It does not require Firebase or an AI provider.

## Repeatable automated checks

From the private-app directory:

    npm run test:archive
    npm run test:rules
    npx playwright install chromium
    npm run test:browser

GitHub Actions runs the same commands using Node 22 and Java 21. Consult the most recent PR #5 Actions result rather than treating committed tests as proof of success. Firebase official emulators check outsider/unauthenticated denial, cross-discussion isolation, declined proposals, immutable history and authentication; Chromium at 390 px tests two independent accounts, named discussions, source messages, 40-message paging and jump-to-latest, previews, the honest mock AI, approval and rejection, adventure stages, independent export/restore and browser-profile reopen. All test records and images are fictional.


## Usability boundaries for the next private trial

The new user-facing architecture is **general chat + a discussion per adventure**, with inline plans and limited initial message loading. It intentionally avoids creating a separate chat for every passing thought. This remains a fictional local pilot, not a service with real long-term content.

- **Still to build or test:** cross-device unread indicators, full-history search, automatic linking/deduplication of closely related adventures, real iPhone Safari/Home Screen behaviour, production image handling and a real vision-capable AI. Avoid claiming those capabilities.
- **Agreement conflicts:** the interface warns if independent proposed replacements of one earlier decision are both agreed. Full prevention of concurrent contradictory agreements requires a stronger server-side decision-group invariant before real content is used.
- **Compatibility:** existing pilot messages in the shared room remain readable. New adventure-specific chats use their own stable IDs. Old fiction-only emulator data is disposable and may reset each time the preview restarts.
- **After pulling a source update:** type `q` and press Enter to stop the running pilot, then restart `npm.cmd run pilot` so Firestore Security Rules and the mock AI gateway reload. New disposable credentials are printed in the terminal.

## Windows port-8081 troubleshooting

If the pilot reports "Firestore Emulator, port taken", a previous Windows Java emulator may still be holding port 8081 after Ctrl+C. You do not need to reinstall Java, Node or Firebase. The runner checks common ports before launching and now stops the entire launched process tree, with a Windows-specific startup/shutdown test.

In PowerShell, inspect the owner of port 8081:

    $listener = Get-NetTCPConnection -LocalPort 8081 -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($listener) {
        $processInfo = Get-CimInstance Win32_Process -Filter "ProcessId = $($listener.OwningProcess)"
        $processInfo | Select-Object ProcessId, Name, CommandLine
        if ($processInfo.CommandLine -match 'cloud-firestore-emulator') {
            Stop-Process -Id $processInfo.ProcessId -Force
            Write-Host "Stopped the previous Firestore emulator."
        } else {
            Write-Host "Another application owns port 8081; nothing was stopped."
        }
    }

Only stop the verified Firestore instance, never a random Java process. Then run npm.cmd run pilot again. Future exits should use q followed by Enter.

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
