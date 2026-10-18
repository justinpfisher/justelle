# Justelle private adventure planner

Development source includes two-member shared adventures, versioned itinerary changes/Undo, booking anchors and protected originals, journey/day views, deterministic on-demand Feedback, typed member instructions, Today projections, encrypted recovery and local archive-copy staging. The app also retains earlier chat/decision records for compatibility. This is not a claim that the full vision, cloud deployment, live AI or OneDrive sync is qualified.

Current implementation/acceptance evidence lives in [Where We Are](../docs/WHERE-WE-ARE.md). Follow [AGENTS.md](../AGENTS.md), [Adventure Planner V1](../docs/ADVENTURE-PLANNER-V1.md) and the single [release/configuration runbook](hosting/OPERATIONS.md). Do not use the historical chat-first pilot as product acceptance.

## Develop locally

Use `main`, Node 22.13+ (including built-in SQLite), Java 21+, npm and a modern browser. From `private-app`:

```sh
npm ci --no-audit --no-fund
npm run pilot
```

Open `http://127.0.0.1:5173/`. The terminal provides two disposable fictional accounts; use separate browser profiles. Type `q` then Enter in the preview terminal to stop cleanly, especially on Windows. The preview uses local Firebase emulators and deterministic AI only. Use fictional records, never real private data. Real iPhone Home Screen behaviour requires hosted/device evidence.

## Checks

```sh
npm run test:archive  # model, adapters, recovery and release logic
npm run test:rules    # Firebase emulator access/data integrity
npm run test:browser  # two-member phone/desktop browser flows
npm run build
npm ci --prefix hosting/functions --no-audit --no-fund
npm run test:package # isolated deploy package loading/HTTP routes
npm run test:preview # local runner lifecycle; Windows when runner/dependencies change
```

The CI workflow selects additional Windows and hosted checks by affected paths. Keep its stronger checks for access, history, recovery, dependencies and deployment changes. Browser screenshots contain fictional fixtures only.

## Preservation

[Encrypted recovery commands and format](memory/README.md) restore without Firebase or an AI provider. `memory/stage-archive-copies.mjs` verifies independent local copies, including a locally synchronized OneDrive folder; this alone does not prove cloud upload or clean-device recovery. The [archive policy](../docs/BACKUP-ARCHIVE-POLICY.md) governs exclusions/deletion. Keep exports, credentials, originals and diagnostics outside public GitHub. Provider/account authorization already exists within [recorded limits](../docs/production-launch-decision.md); cloud setup and actual live qualification remain separate from working source.
