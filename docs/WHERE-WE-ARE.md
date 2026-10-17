# Justelle — Where we are

**Private application:** NOT VERIFIED LIVE. The earlier private chat pilot and itinerary data model have development tests, not a qualified public-facing private planner.

**Accepted milestones:** 1/8. **V1 release milestones:** 0/4. **Private-app PR #5:** Draft development PR.

This page is generated from issues #20–#27. Checkboxes are evidence-tracking controls, not proof of a live app.

## Roadmap

| Milestone | Horizon | Criteria | Recorded status |
| --- | --- | ---: | --- |
| [M0 — Development foundation](https://github.com/justinpfisher/justelle/issues/20) | Foundation | 5/5 | Complete |
| [M1 — Shared records and recovery](https://github.com/justinpfisher/justelle/issues/21) | V1 | 0/6 | Current |
| [M2 — Journey-first iPhone planner](https://github.com/justinpfisher/justelle/issues/22) | V1 | 0/6 | Upcoming |
| [M3 — Controlled AI planning](https://github.com/justinpfisher/justelle/issues/23) | V1 | 0/5 | Upcoming |
| [M4 — Secure iPhone production launch](https://github.com/justinpfisher/justelle/issues/24) | V1 | 0/6 | Upcoming |
| [M5 — Travel-day essentials and discovery](https://github.com/justinpfisher/justelle/issues/25) | Later | 0/5 | Upcoming |
| [M6 — OneDrive archives and efficient backups](https://github.com/justinpfisher/justelle/issues/26) | Later | 0/6 | Upcoming |
| [M7 — Mature usability and sustainability](https://github.com/justinpfisher/justelle/issues/27) | Later | 0/5 | Upcoming |

## Immediate next evidence

**[M1 — Shared records and recovery](https://github.com/justinpfisher/justelle/issues/21)** is the first incomplete milestone. Next unchecked acceptance criterion:

> Connect the adventure, stays, nights, transfers and possible/planned state to protected Firestore records with two-member access rules.

Only check this when verified. See [implementation Issue #4](https://github.com/justinpfisher/justelle/issues/4).

## Verified evidence versus outstanding work

- **M0:** Fictional two-member browser/emulator checks, encrypted independent recovery, prepared hosting/AI source, and a pure itinerary model were exercised. This is a **development** milestone, not a hosted pass.
- **M1–M3:** New journey-first app, authenticated plan/booking history, independently restorable new record types, and bounded AI still need new acceptance evidence.
- **M4:** Real Firebase environments, protected original media, cloud B2 restoration, physical iPhone Home Screen, production access and tested rollback must pass before the app is called live.
- **M5–M7:** Today/offline/research, Windows/OneDrive permanent archives and mature usability follow the first launch. [The archive policy](BACKUP-ARCHIVE-POLICY.md) is approved, but its automation is not live.

## Keeping this view current

Each milestone has one issue with an **Acceptance checklist**. Developers and AI agents must link verified evidence and check off criteria as they are met; close the issue only when every criterion passes. [The status workflow](../.github/workflows/project-status.yml) reads checklist and issue open/closed state and regenerates the repository README and this document on changes and daily fallback. It never triggers a deployment, expands access or spends money.

A closed issue with unchecked criteria appears as **Review needed**, while an all-checked open issue appears as **Ready for review**. If the update workflow fails, the displayed page may be stale: [check its runs](https://github.com/justinpfisher/justelle/actions/workflows/project-status.yml) and read the issues directly.

**Related:** [Issue #4](https://github.com/justinpfisher/justelle/issues/4) · [PR #5](https://github.com/justinpfisher/justelle/pull/5) · [Archive implementation #19](https://github.com/justinpfisher/justelle/issues/19) · [Product vision](PRODUCT-VISION.md).
