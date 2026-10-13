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
- The local fictional preview uses the authenticated Firebase Storage SDK. Reserved download-token behaviour is not qualified by local Rules. The prepared hosted route uses authenticated token-free GCS media handlers and denies direct SDK access; actual hosted token/IAM checks remain required.
- The emulator-only test AI gateway verifies member authentication and room membership, loads **only the active discussion context** and related confirmed plans, and checks original-image SHA-256 digests before passing bytes through a replaceable provider interface. **The deterministic assistant cannot answer factual questions or interpret images**, states that limitation clearly, and makes draft plans **only when explicitly asked**. No external AI API is called.
- Plans appear **within the discussion they concern**, not in an unrelated global list. Human suggestions can be agreed to by both members or passed on by either person. The interface says **Just a suggestion**, **You said yes. Waiting for [other member] to weigh in**, **Not for us**, or **We both said yes**. Who agreed or declined is retained. A new agreed version supersedes an old one in the interface without changing the original record. Only one change to the same confirmed plan can become agreed; a competing proposal becomes an earlier suggestion rather than a second current agreement. Original decisions remain immutable.
- An adventure can begin as an idea, plan, experience or spontaneous memory and change direction; immutable events preserve who changed it and when. Older pilot history is retained when its first event is added. **Its stage is not the same as mutual agreement**, which still requires two explicit confirmations for significant decisions. The source message and all linked attachments remain independent records.
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
- **Agreement integrity:** a revised plan must atomically claim the agreement it replaces. Two competing changes cannot both become current, even when their final approvals race. Firestore rules reject forged claims and stale revisions; the archive rejects conflicting locked revisions. This is fictional-emulator logic, not yet hosted qualification.
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

The result contains a memory.sqlite database and media files. Both are readable without any Firebase credentials. This browser demonstration archive is **not encrypted**. The separate [encrypted backup foundation](memory/README.md) now streams consistent fictional Firebase snapshots into authenticated archives and restores independently. Emulator recovery is verified; an automated hosted backup, durable destination, retained generations and recovery-key custody remain before real-content use.

## Protection and launch boundaries

The repository and branches are PUBLIC. No real member identities, credentials, messages, personal images, itineraries or exported private backups belong in this repository, GitHub issue, workflow logs or published assets. The app shell and approved artwork are not secrets; stored records and original images are member-only according to emulator-tested Firebase Security Rules.

Keep draft PR #5 outside production `main` until GitHub Pages publishing paths have been independently verified. Focused verified changes may be merged into its development branch. Source changes must not accidentally expose the private-app subfolder as live public content. The public homepage, its illustration and CNAME are untouched here.

Before a hosted private launch, establish an owned Firebase project on Blaze billing (Cloud Storage requires Blaze), a separate protected deployment/hostname, two real Auth identities and secure enrolment, a metered server-side vision-capable AI adapter, provider credentials kept outside GitHub, hard request/rate caps and spending alerts, and encrypted independent backups with tested restore. Repeat hosted direct-media, outsider, token replay/revocation, iPhone Safari/Home Screen and actual HEIC/mobile usability checks. No paid service or production user was activated in this pilot.

## Account and cost decisions before activation

No new paid service, billing plan, real account or AI call was activated during development: **C$0 of new service spending was authorised or activated**. Local emulators and offline recovery do not establish a monthly production invoice.

Before a hosted trial, approve the Firebase project and its Blaze billing, the final login method, independent backup destination and recovery-key custody. Before AI activation, choose a supported vision model and approve current CAD pricing (exchange-rate margin and taxes included) plus explicit daily/monthly allowances. The inactive adapter refuses expired or absent pricing and reserves its maximum request cost before generation. It does not assume a ChatGPT subscription pays API charges.

Earlier C$1–38 estimates were illustrative and have been removed from the launch decision record: model, destination, live usage, region and exchange rate have not been selected or measured. A budget ceiling is a decision, not a guaranteed invoice. Firebase’s current [billing guidance](https://firebase.google.com/docs/projects/billing/avoid-surprise-bills) distinguishes alerts from spend caps and limits spend-cap support to specific services; do not assume all Firestore/Storage spending stops at an alert. [Cloud Storage billing requirements](https://firebase.google.com/docs/storage/faqs-storage-changes-announced-sept-2024) still need to be satisfied before hosted image use.

All code and recorded synthetic test assets belong to the private pilot directory. Nothing has been deployed to justelle.life.
