# Justelle repository instructions

## Current private-product authority (17 October 2026)
**Long-term product end goal:** [Mature Product Vision](docs/PRODUCT-VISION.md) is Justelle's approved journey-first UX north star: an inviting, visually intelligible adventure that takes shape from natural input. The primary phone experience is a journey of places, nights and meaningful transfers; a 21-day grid is a useful optional detail view, not the default product metaphor. Keep unscheduled possibilities, intended plans and externally confirmed reservations distinct. Provide connected map/day/bookings, contextual AI with immediate validated edits and Undo, short evidence-backed on-demand research/feedback, practical Today/offline essentials and an accessible light/warm interface.

**First release:** Follow [Adventure Planner V1](docs/ADVENTURE-PLANNER-V1.md) for implementation order and acceptance; it delivers a smaller slice of the mature vision, not a different product. Preserve [Build, Borrow and Replace](docs/BUILD-BORROW-REPLACE.md) and existing privacy, deployment, backups and qualification rules.

**Backups and finished trips (approved 17 October):** [Low-Cost Backup & Archive Policy](docs/BACKUP-ARCHIVE-POLICY.md) is authoritative: incremental protected backups for active adventures, existing B2 as initial cloud recovery, complete encrypted sealed-trip archives through an owner-managed Windows mini PC to existing Microsoft 365 Family OneDrive storage, an independently held non-sync local copy, verified restoration before exclusions/deletions, and archived trips still browsable in Justelle. Keep the production app independent of the home PC. Implementation and live qualification remain outstanding. Exact navigation/tab labels, canvas gestures and visual mockups in the product vision remain testable design hypotheses; the user-outcome and booking-trust principles are authoritative. These newer directions supersede chat-first interaction, required two-member approval and scrapbook scope without discarding working protected groundwork.

## Open-source-first, replaceable architecture (approved 17 October 2026)

Before adding a feature or dependency, read [Mature Product Vision](docs/PRODUCT-VISION.md), [Adventure Planner V1](docs/ADVENTURE-PLANNER-V1.md) and [Build, Borrow and Replace](docs/BUILD-BORROW-REPLACE.md). **Reuse suitable existing code; then evaluate small, maintained, properly licensed open-source components; then specialist managed services when they materially reduce maintenance or improve reliability; write bespoke code for Justelle-specific experience, canonical planning rules, security and history.** Do not default to building infrastructure from scratch.

Keep the app nimble: one canonical provider-independent adventure model, simple interfaces at genuine external boundaries (maps/geocoding/routes, research, AI, document import), a single provider per capability unless needed, and complete portable recovery. "Plug and play" means replaceable, reviewed adapters—not dynamic execution of unknown third-party code or a universal plugin marketplace. Review licence, maintenance, security, data privacy, iPhone performance, outage fallback and **CAD costs/approved limits** before installation or activation. No new paid API, public disclosure, or expansion of access without the applicable authorization. Keep the current Firebase/auth/protected media/AI gateway/backup groundwork.

For each significant dependency/provider decision, include a **brief** build-vs-borrow rationale, alternative, cost/licence/privacy check, and replacement/test plan in the implementing issue/PR. Avoid new architecture documents or abstractions for routine changes. Candidate libraries/services named in the policy are **not** automatically approved, installed or live. The existing AI model-only spending controls do not automatically authorize web-search charges.

## Purpose and authority
Maintain https://justelle.life/ from `justinpfisher/justelle`, default branch `main`. Read [the project brief](docs/PROJECT.md) and relevant source before changing behaviour. The latest explicit user direction governs scope and publication.

Justelle has a deliberately simple public homepage and a separate planned **private adventure planner** for two members: a journey-first route and overnight-stay overview, free-standing ideas, connected days/map/confirmed bookings, personalized on-demand research/AI Feedback and immediate audited edits. Archives support practical reference and lessons; scrapbooks and general household management are not core product aims.

## Public content and private data
Approved public categories are Justelle branding, approved illustrations, first names, relationship milestones, and broad trip destinations and months. Other personal content is private by default. Material supplied for private use is not approved for public publication.

This repository, branches, history, issues, pull requests, logs and published assets are public. Never place private photos, stories, detailed itineraries, booking information, correspondence or credentials here. Do not import personal information from unrelated projects or conversation history.

Private features must protect pages, records, images and downloads through real authentication and authorization outside public static assets. Hidden links, obscure URLs, robots rules and client-side password screens are not privacy controls. Test direct unauthenticated and unauthorized retrieval before adding real private data.

## Preserve the current experience
- Preserve `CNAME` (`justelle.life`), approved artwork and the “Justelle. Still us.” identity.
- Keep the homepage simple, warm, playful, mobile-friendly and accessible; retain the calm teal/ocean direction.
- Use Canadian English.
- Use `America/Toronto` for date-sensitive behaviour.
- Preserve together since August 11, 2006 and married since June 24, 2011; calculate elapsed time and anniversary greetings.
- Keep month-only plans month-only. Do not invent departure dates or infer that a past plan occurred.
- Do not invent memories, quotations, photos or travel details.

## Implementation
**Public homepage:** keep its existing static HTML/CSS/JavaScript, no new build framework or external dependencies unless specifically justified. **Private planner:** reuse working protected infrastructure; introduce a lightweight UI library only if a focused proof shows it materially improves the synchronized map/day/booking experience. Explain new costs/account/maintenance requirements before selecting or activating new services.

Keep Justelle separate from Stammtisch and other projects. Reuse useful setup, preview, verification and documentation practices, not their content, credentials or publishing pipelines. Do not introduce recurring automation without a request.

## Workflow and verification
Work in focused branches and pull requests. Complete authorized tasks without repeated confirmation; ask when missing information materially changes the outcome or the work introduces new spending, an audience expansion, or publication of unapproved personal content. Merge and publish only within the active task's authorization.

For documentation-only changes, verify consistency with current source and the changed-file scope. Do not add tests that merely repeat documentation.

For behaviour changes, verify relevant outcomes. Date logic checks should cover Toronto midnight, anniversary boundaries, leap years, daylight-saving transitions and trip-month rollover where affected. UI changes should be checked on phone and desktop sizes, with keyboard access, meaningful image descriptions and a readable fallback if JavaScript fails. Document actual commands as checks are introduced.

Keep private originals, credentials and sensitive diagnostics out of test fixtures and build output. For private features, test both successful access and rejection of unauthenticated and unauthorized direct requests.

Inspect relevant existing changes; avoid overwriting unrelated work. Report what changed, why, what was checked and material limitations. Distinguish committed source, merged source and verified live publication.

Do not add compulsory execution-mode selection, model-verification gates, launch restrictions or any version of the discontinued Universal Autonomous Advancement Protocol.

## Private application continuous release
The October 13 production-launch approval and latest task authorise Justelle's private-app service setup and release within the recorded limits. Future authorised private-app changes include implementation, checks, merge, production deployment and live verification as one task; no separate go-live prompt is needed. Preserve the root homepage completely. Use separate fictional qualification and production projects, private runtime configuration, short-lived deployment credentials and encrypted independent recovery. Distinguish source, emulators, hosted checks and physical iPhone evidence. Complete the initial hosted/recovery/device/cloud-rollback requirements before enabling production automation. Routine successful releases should not introduce renewed account or spending approvals. Report genuine external account or device handoffs precisely.
