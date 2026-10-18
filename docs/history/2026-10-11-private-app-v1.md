> HISTORICAL — retained evidence only. Do not execute these instructions. Current authority: [AGENTS.md](../../AGENTS.md); current release operations: [OPERATIONS.md](../../private-app/hosting/OPERATIONS.md). Relative links below describe the original location and may no longer resolve.

> **Historical private-app decisions (11 October):** [Adventure Planner V1](ADVENTURE-PLANNER-V1.md) and [Build, Borrow and Replace](BUILD-BORROW-REPLACE.md) are the current product and engineering authority. The older chat-first, mandatory mutual approval and scrapbook sections below are **superseded**. Preserve verified security, protected media, provider-neutral identities, backups and portability; do not mistake older pilot tests for acceptance of the new planner.

# Justelle private app — first-release decisions

**Decision date:** October 11, 2026 (America/Toronto)
**Status:** Product direction agreed; implementation, vendor activation and deployment not authorized by this document.
**Authority:** Latest user decisions and `AGENTS.md`. This document records what the first private experience must deliver without changing the existing public homepage.

## Purpose

Make Justelle a tiny, natural-language shared space for two people to dream, deliberate, plan and remember. A private Safari Home Screen web app should feel effortless to open and use. An idea (restaurant, date night, weekend outing, major adventure) can mature into a plan and later become a memory without losing its source conversation.

Use **Firebase-first** for the initial private-app build: Firebase Authentication for individual accounts, Firestore for shared records, and private Firebase Cloud Storage for images and screenshots. Keep all Justelle records portable so backend, photo and AI services can be replaced. This is a first-release implementation preference, **not** a permanent vendor lock-in or authorization to start billing.

## Confirmed experience

- **Two individual accounts, shared context.** Each person can converse independently or contribute to the same shared conversation and see the other's contributions. Initially assume only two members; no invitations or additional audiences without authorization.
- **Ordinary opening requires no login.** An installed iPhone Home Screen web app should reuse a secure persistent session on a trusted device. Authentication may be required for first use, resets and exceptional security events, but do not require a login or Face ID every time the app opens.
- **Natural language first.** Add a message, quote, note, restaurant suggestion, concert idea, date-night possibility or trip question without filling out forms. The interface should prioritize easy updates from a phone.
- **Images are essential in the first release.** Users must be able to attach and preview screenshots, maps, menus, restaurant facades and other ordinary images within a conversation. Uploaded images remain associated with their message, relevant idea/adventure and future record. A vision-capable AI can discuss an image on request; do not treat image interpretation as a verified fact without appropriate checks. Support normal iPhone uploads (including a practical HEIC handling path), reasonable size limits, legible map/menu text and errors/retries.
- **Proposals are not decisions.** AI suggestions and human brainstorming remain proposals. Significant agreements require explicit, attributable confirmation from both members to become locked. A replacement creates a new proposed change while preserving the agreed version and history. AI cannot overwrite locked decisions, bypass the approval mechanism or use unrestricted privileged database writes.
- **Adventures grow into memories.** Preserve original conversation, ideas, proposals, decisions, timestamps and selected image attachments. A later memory view can build on this same material; a full photo archive is not required for first use.
- **Replaceable AI.** The app uses a server-side AI gateway/adapter and Justelle-owned canonical records. AI provider calls and tools may change independently of stored conversations/decisions. An existing personal ChatGPT subscription must not be assumed to fund embedded API usage.
- **A portable memory core.** Use stable Justelle record/person identifiers separate from Firebase Auth UIDs; record authorship, versions and relationships. Provide a provider-neutral export of messages, decisions, attachments and metadata, with checksums and a restore path outside Firebase.

## Explicitly deferred

- Automatic Apple Photos / private Shared Album integration, bulk library synchronization, native iOS photo access, galleries, photo curation and video libraries.
- Full-blown travel booking, calendar replacement or a universal multi-provider framework.
- Sophisticated lost/unlocked-device measures, repeated biometric challenges and compulsory daily sign-in. The goal is to prevent unintended web discovery, not impose friction on trusted phones.
- Publishing private messages, images, trip details or memory records in the public repository or on the public homepage.

## Minimum security and operational boundary

The repository is public, including branches, PRs, issues, history and generated public assets. It holds only application source, tests, fictional fixtures and safe documentation. Store actual messages, images, credentials and planning only in a protected private service, never in GitHub.

Privacy still requires *real* sign-in, verified membership and authorization of **both records and direct image/download requests**; hidden links, robots rules, obscure paths and browser-only passwords do not suffice. Do not create long-lived publicly retrievable media links. Limit AI backend permissions and keep provider credentials server-side. Avoid unnecessary caches of private data on shared devices; trusted-device convenience takes precedence over frequent reauthentication.

Choose the final login provider, custom domain/hosting, billing plan, operational cost cap, independent encrypted backup destination and recovery method before activating accounts or adding real personal content. Firebase Storage requires a billing-enabled project even if usage falls under no-cost allowances. Explain any new subscription or cost before commitment.

## Demonstrated versus outstanding

[Draft infrastructure PoC PR #2](https://github.com/justinpfisher/justelle/pull/2) uses fictional accounts, conversations and a synthetic photo. Five Cloudflare-compatible local checks passed; four official Firebase emulator tests passed; a two-account, phone-sized Chromium session/reopen test passed. These do **not** verify hosted Firebase, actual Safari/iPhone sessions, a live AI provider, real-image processing or independent production backup.

## Next focused delivery: working shared pilot with only fictional data

1. Review the current public hosting and DNS before attaching a protected `app.justelle.life` (or equivalent) experience. Do not disrupt the existing homepage.
2. Prepare a minimal Firebase pilot, no real people or memories. Verify two independent accounts and normal persistent sessions on actual iPhones, including Home Screen use.
3. Implement a conversation with text, screenshots and photos; render previews and securely retrieve original media. Test direct unauthenticated and non-member access, file overwrite attempts and links.
4. Add the AI gateway with an image-capable model. AI can explain/propose but not silently modify locked decisions. Set request/usage budgets before any paid AI activation; use deterministic fake-AI responses until authorized.
5. Test competing or simultaneous decisions, approval attribution, revision history and a human-readable portable export with media checksums.
6. Restore encrypted backup archives independently, including original images and relationships, before any real personal content is introduced.
7. Measure actual build effort, storage/traffic and running costs using synthetic usage; document the results and select a billing plan **before** changing the live site or inviting real accounts.

**Pilot success:** Both participants can open the app easily, share the same conversation, attach a legible screenshot, obtain an AI proposal, explicitly agree on a decision, and recover their records outside the provider. Private data must not be retrievable through unauthenticated direct URLs.

The public homepage remains deliberately simple. No private feature, backend, photo synchronization or deployment is represented as operational by this decision document.
