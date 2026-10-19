# Justelle repository instructions

## Authority

Latest explicit owner decisions → this file (operating rules) → [Product Vision](docs/PRODUCT-VISION.md) (mature outcome), [Adventure Planner V1](docs/ADVENTURE-PLANNER-V1.md) (first release), [Build, Borrow and Replace](docs/BUILD-BORROW-REPLACE.md) (technology), and [Backup & Archive Policy](docs/BACKUP-ARCHIVE-POLICY.md) (preservation). [Operations](private-app/hosting/OPERATIONS.md) is the single release/configuration runbook. [Where We Are](docs/WHERE-WE-ARE.md) is the current evidence/status view, generated from milestone issues #20–#27. Other documents link to these authorities rather than redefine them. Newer approved decisions supersede older instructions. `docs/history/`, closed PRs and old issue comments are historical evidence, never active gates.

## Product and boundaries

Justelle is a private, adventures-first, journey-first iPhone planner for two members. Show places, nights, transfers and unscheduled possibilities; days/map/bookings are connected views of one portable record. Either member edits immediately with attributable history and Undo. No mutual approval or locked-plan workflow. Preserve existing historical pilot records without treating their old behaviour as current product requirements. Real supplier bookings remain independent of planned changes. AI is replaceable, scoped, on demand, and cannot invent confirmations or write unrestricted records. No recurring AI review, household-management expansion, mandatory galleries or bulk photo import.

Preserve the public `index.html`, `CNAME` (`justelle.life`), approved artwork and “Justelle. Still us.” identity unless explicitly asked to change them. Keep its static, dependency-free implementation. Private deployment is separate at `app.justelle.life`. Use Canadian English and `America/Toronto` for date-sensitive app behaviour. Keep month-only dates month-only; never infer completed trips or invent memories. Public relationship dates remain August 11, 2006 and June 24, 2011.

This repository, branches, issues, logs and assets are public. Never put private photos, exact itineraries, bookings, correspondence, real account identities, credentials, exports or diagnostics here. Approved public content is branding, approved illustrations, first names, relationship milestones and broad destinations/months. Protect private records and original files with genuine member authentication/authorization; obscure URLs and client-side screens are insufficient. Keep Justelle identities/content separate from other projects.

## Delivery

Owner direction, 18 October 2026: default ordinary design, coding, npm builds, browser/emulator fixtures and affected checks to the GMKtec local Windows checkout before GitHub. Do not commission a cloud dev/agent machine for work the PC can do. **Keep independent PR CI, automatic project-status and Pages on standard GitHub-hosted runners:** the source repository is public, these standard runner minutes are free, and public fork pull requests must never be able to execute on the owner's personal computer. No runner/credential sharing with thefish, Stammtisch, Comparative or LCRS. Host-dependent acceptance and eventual secure deployment still require their actual authorised environment; never call an unrun local check or an undeployed change successful.

Use one source baseline: `main`, focused branches and PRs. An ordinary owner change request includes implementation → appropriate checks/review → merge → established deployment → live verification. No second routine permission to merge or go live. Source may merge while initial private deployment is disabled; never equate source integration with production acceptance. Preserve separate fictional qualification and production environments, private configuration, short-lived deploy credentials, approved spending limits and independently restorable encrypted backups.

Use the smallest checks that cover the actual change:
- Documentation: consistency, links and scope; no emulator, hardware or paid-provider requalification.
- Interface/compatible behaviour: relevant model/browser/build checks and automated post-release smoke checks.
- Authentication, permissions, private files, data/history, recovery, provider spending, dependencies, deployment or unknown runtime changes: focused stronger tests and isolated hosted qualification before production. Destructive migrations need an explicit recovery plan.

The workflow classifies changed paths conservatively. Initial hosted, recovery, device and cloud rollback evidence is established once. Reuse it unless a change affects that assurance or a failure gives concrete reason to repeat it. Windows preview checks concern the local runner, not every phone layout change. Routine interface releases do not rerun paid AI/B2 acceptance. Never mark an unperformed check as passed or disable a real protection to get green CI.

No new sensitive authority, unapproved audience/publication, service commitment or spending beyond existing approval. Existing provider/amount approvals do not need renewing for routine operations. No model, reasoning-level, usage or execution-mode gates, or retired autonomous-advancement protocol.

## Maintenance

Reuse working code and suitable licensed maintained components. Keep adapters thin and only at real external boundaries. Significant new dependencies/providers need a short PR rationale covering alternatives, licence/privacy, CAD cost and replacement; routine edits need no new architecture document. Do not add a service, framework, manual gate or recurring process without a concrete benefit, simpler alternative and retirement/reassessment condition proportionate to its maintenance.

Update milestone criteria only when acceptance evidence changes; one linked PR/result is enough. Close only fully verified milestones. Do not hand-edit generated status or require unrelated milestone completion for a safe update. Preserve provenance, originals and recovery evidence. Inspect existing changes, avoid overwriting unrelated work, and report what changed, tests, merge/deployment state and genuine limitations concisely.
