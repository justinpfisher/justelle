# Justelle — build, borrow and replace operating policy

**Approved:** 17 October 2026 (America/Toronto)  
**Status:** Authoritative product/engineering policy for the private adventure planner. This directs future selections; it is not an installation, API activation, purchase, or claim that candidates are already integrated.

Read with [Mature Product Vision](PRODUCT-VISION.md), [Adventure Planner V1](ADVENTURE-PLANNER-V1.md), [AGENTS.md](../AGENTS.md), and the existing security/release rules. Latest explicit owner decisions control. The public homepage remains untouched.

## Operating objective

Build a simple, beautiful, private planner for two people that remains easy to change over a decade. Invest in Justelle's **experience and durable records**, not custom infrastructure that others already maintain.

**Default decision order for every feature:**

1. **Reuse** trustworthy working code already in Justelle, where suitable.
2. **Adopt** the smallest actively maintained, suitably licensed open-source library or component with a demonstrated fit.
3. **Connect** a reputable managed service for costly, fast-changing capabilities or data, only when a self-managed alternative would create more maintenance, risk, or inferior results.
4. **Build bespoke** only when the behaviour is central to the Justelle experience, genuinely unavailable through a suitable component, or required for control, privacy, integrity, portability, or recovery.

Open-source first is a **selection preference, not a command to self-host everything**. The stronger option may be a managed service where uptime, data freshness, support, or maintenance dominate. Free-of-licence-cost does not imply free to operate, secure, lawful to redistribute, or low-maintenance.

Keep choices proportional to **two private members**, an iPhone Home Screen web app, low ongoing spending and the existing production qualification gates. Do not add infrastructure merely because it could someday be useful.

## What Justelle owns and builds

- **Adventure experience:** Upcoming-first home; **journey-first** overview with destination nights, significant transfers and unscheduled possibilities; configurable week/day detail (21 days is an example, not a default grid); movable stays with a non-drag editing path; clear planned versus possible versus externally confirmed booking indicators; linked map/day/place/booking interaction and a practical Today mode.
- **Canonical planning model:** Adventure IDs, stable place relationships, itinerary blocks, travel segments, personal/adventure preferences, sources, recommendations, booking anchors and optional archived lessons. It is not a generic knowledge graph.
- **Booking truth:** A planned stop is not a purchased reservation. External booking dates, status and original protected confirmations are independent from movable blocks. Flag discrepancies; never claim editing Justelle rebooks external services.
- **Equal collaboration:** Both members can immediately edit the plan. Record server-attributable before/after audit events, time, original source and prior versions atomically with revisions. Prevent silent concurrent clobbering; undo is another event. No co-approval or locked-decision workflow.
- **Personalized, on-demand guidance:** Relevant interests, traveller group (couple/family), food needs and explicit past-trip lessons inform AI Feedback and travel research. Preserve the difference between confirmed facts, research findings and model inference. AI-generated alternatives need member-selected Apply; unambiguous direct member instructions may update after validation.
- **Product-specific AI instructions and safe change handling:** Justelle validates typed AI actions, checks authorization, shows concise results and limits AI context. The model receives no unrestricted database-writing rights.
- **Durability:** Stable provider-neutral Justelle IDs, human-readable data formats, original protected files, complete relationship/audit export, authenticated encrypted backups, and independent restoration without Firebase or the AI provider.

The application should own these **behaviours and records**, not implement its own low-level map renderer, geocoder, PDF engine or foundation model.

## What to borrow: candidate technologies, not automatic approvals

| Need | Preferred approach | Candidate(s) for a small proof |
| --- | --- | --- |
| New visual planning interface | A lightweight component framework only if it reduces synchronization complexity over current plain JS | Svelte |
| Drag/resize city blocks on a touchscreen | Small maintained interaction library with keyboard/date-entry fallback | interact.js |
| Interactive map | Open-source renderer; replaceable tile/coordinate service | MapLibre GL JS |
| Maps, geocoding, places and route estimates | Managed geographic API rather than self-hosted tile or routing infrastructure | Geoapify; compare MapTiler/other compliant providers |
| PDF viewer and text rendering | Existing maintained library rather than custom parsing | Mozilla PDF.js |
| Calendar/date manipulation | Established small library where native JS is insufficient; retain local time zone and true booking dates | date-fns |
| Offline essential itinerary and reservations | Minimal controlled local cache/service worker, not a new sync engine | Workbox where justified |
| AI vision, planning and interpretation | Existing server-side provider-neutral AI adapter with budgets and output validation | Current approved AI provider; changeable later |
| Current research and traveller perspectives | Permitted provider search with evidence, dates and links; no mass scraping or local mirror | Provider's web search, or separate search API if objectively better |
| Authentication, persistence, protected media | Reuse selected and tested managed foundation | Firebase Auth / Firestore / private Storage |
| Independent recovery | Retain encrypted, provider-independent exports with restore tests | Existing backup implementation and independent B2 destination for active recovery |
| Completed-trip archival | Stop repeatedly copying unchanged trips; keep protected on-demand access and independently restorable encrypted originals | Owner's existing Microsoft 365 Family OneDrive storage through an owner-managed Windows mini PC, plus a non-sync local recovery copy; see [Low-Cost Backup & Archive Policy](BACKUP-ARCHIVE-POLICY.md) |

**Do not treat a candidate as installed, selected, currently licensed for our use, free at production volume, or activated.** Before adoption, verify the current licence, redistribution obligations, maintainer activity, security advisories, iOS compatibility, deployment size, usage terms, data rights/caching and genuine improvement. Prefer existing dependencies and native browser capabilities when sufficient. Install no new package merely to satisfy this table.

## Explicitly avoid building

Do not create proprietary map engines, self-hosted tile/geocoding infrastructure, flight/hotel purchase engines, generic calendar suites, bespoke PDF/OCR engines, custom foundation LLMs, autonomous background travel agents, full photo galleries, high-complexity offline synchronizers, automated bulk scraping, sprawling universal knowledge graphs, or plugin marketplaces in V1. Use links to established booking providers and bring confirmations into Justelle.

Do not reproduce the entire feature set of commercial travel planners. Borrow the best user interaction patterns, but keep Justelle's plan and audit data independent from those vendors.

## Replaceability without overengineering

Treat a **plug-and-play integration** as a small, documented, testable boundary around a real outside dependency—not arbitrary executable modules that can be downloaded and installed at runtime.

- Keep the itinerary, bookings, sources, preferences and event history in **Justelle-defined versioned structures**, not provider-specific response objects or external conversation/thread IDs. Preserve relevant external IDs as optional references only.
- Keep provider credentials, cost controls and authorization on the server. Never place API secrets in browsers, repositories or public logs. Send third parties only task-relevant information; avoid exposing traveller identities or booking codes to public web searches.
- Introduce thin adapters for **genuine substitution points** such as AI, web research, place lookup/geocoding, routes, mapping data and import/conversion. Define their expected inputs, outputs, errors, limits and provenance; don't wrap every internal function or invent an abstract plugin platform.
- Prefer a **single provider per capability at a time**, with a straightforward fallback (for example manual place entry, a plain itinerary list, opening Apple Maps, or saving the booking source) when unavailable. Multiple simultaneous vendor integrations need a demonstrated benefit.
- Pin or lock dependency versions; evaluate upgrades and transitive dependencies; review permissions and licences. No unreviewed runtime code loading, supply-chain bypass or silent external data transmission.
- When substituting a provider, use fictional contract fixtures to demonstrate equivalent normalized results, authorization, graceful failure and record portability. An adapter swap must not require rewriting or losing past adventure records.
- Separate the server's trustworthy booking/date checks from AI suggestions. Route estimates are estimates; only source-backed bookings are confirmed.

### Minimum adapter contracts (illustrative; implement only as needed)

- **Place lookup:** query/place reference + locale -> normalized place name, coordinates if verified, source, provider reference and caveats.
- **Route estimate:** origin/destination + mode/date constraints -> route candidates, units, assumptions and data timestamp (never invent unavailable flights/ferries).
- **Map data:** normalized location/route layers -> provider-independent map markers and optional renderer-specific display.
- **Research:** travel question + scoped interests -> source-backed findings with URLs, retrieval time, limitations and explicit uncertainty.
- **AI planning:** current validated adventure snapshot + scoped instructions/media -> typed edit request, explanatory recommendation or clarification. Only Justelle's authorized transaction layer commits accepted changes.
- **Booking document import:** original protected source -> extracted fields with confidence, provenance, uncertain fields and no implicit "confirmed" status.

These are design seams, **not a requirement to build six adapter frameworks immediately**.

## Feature selection and operational checklist

For any new library, paid API or bespoke capability, document briefly in the implementing issue/PR:

1. **User outcome:** What difficulty does this remove from the iPhone planning experience? Is it needed now?
2. **Reuse/alternatives:** What existing Justelle code and trustworthy open-source options were considered? Why is a new dependency or custom code materially stronger?
3. **Licence/security/privacy:** Version, licence and use obligations; maintainer health; dependencies; where private data goes; approved credentials, least privilege and no direct public file access.
4. **Cost/limits in CAD:** Setup and ongoing usage, free-tier constraints, provider search fees, caps, failure behaviour. Honour recorded spending approvals and get approval for new charges or materially different scope; budget alerts alone aren't hard stops.
5. **Portability/failure:** What canonical records remain ours? How can we replace/remove the integration? What works during a provider outage or without mobile data?
6. **Verification:** Fictional fixtures, real iPhone usability (when hosted), two-member permissions, concurrent edits, source provenance, provider-swap tests where appropriate, actual independent export/restore and release checks.

Record a one-paragraph decision in the PR rather than commissioning a separate architecture document for every minor dependency.

### Existing service and launch boundaries

- Retain the selected Firebase-first architecture and the protected media, AI gateway, and encrypted independent backup work from PR #5. Do not rewrite those merely to use a new fashionable library.
- The 13 October production-launch account/budget authorization remains subject to provider access and hosted/device qualification. **The old AI spending design intentionally disabled web search.** The new product direction includes on-demand cited research, but it is **not automatically enabled or covered by that old model-only budget**; verify pricing, provider terms, new account needs and applicable approvals before activation.
- Production deployment still needs hosted fictional authorization/security, direct-file denial, encrypted independent restoration, actual iPhone acceptance, and safe release/rollback. Keep public `justelle.life` untouched; private app is separate at `app.justelle.life`.
- No real personal content, credentials, private booking references, sensitive medical/dietary records or travel documents go into this public GitHub repository, issues, PRs, artifacts or logs.

## How to know the policy is working

A fictional two-member trip can be assembled by placing and moving city blocks; itinerary/map/bookings reflect the same canonical plan; an external booking doesn't shift when the plan moves; every edit is attributable/reversible; source originals survive independent restore; AI research cites sources and suggestions remain distinguishable; and swapping a map/search/AI provider does not require remodelling the adventure history.

**Practical north star:** The least complex maintainable solution that gives Justelle full control of its information and a seamless, journey-first iPhone experience as defined in [Mature Product Vision](PRODUCT-VISION.md).
