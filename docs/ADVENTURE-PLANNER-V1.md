# Justelle — Adventure Planner V1 direction

**Approved product direction: 17 October 2026 (America/Toronto).**

**Authority:** Latest owner decisions. [Mature Product Vision](PRODUCT-VISION.md) specifies the **long-term end goal**, while this document specifies a proportionate **first release** of the same journey-first experience. The newer direction supersedes the chat-first experience, mandatory two-member agreement/approval, calendar-grid-first metaphor, and memory-scrapbook objectives in earlier private-app specifications. Those earlier documents/tests remain historical evidence, not acceptance of the current product. Keep the public justelle.life homepage unchanged; develop the protected private experience separately at app.justelle.life.

## Product purpose

Justelle is a private, AI-assisted **adventure planner** for two equal members. It should remove planning administration, improve travel decisions and retain trustworthy source/history records. It is not a replacement for personal messaging, photos or souvenirs.

An adventure can begin with one idea, a rough duration, or an approximate destination—without dates, forms or generated detail. Its **primary mobile view is the journey shape**: main destinations, overnight stays in nights, travel transitions, open time, possible alternatives and separately confirmed booking anchors. A configurable day canvas (21 days is merely one example) is a secondary, progressively revealed editing view, not the compulsory whole-trip screen. Both members can directly or naturally edit the **current plan immediately**, with attributable prior versions. Completed adventures are archived for practical reference and useful lessons, not reminiscence or photo-journaling.

## First-release interaction

1. **Home:** Upcoming/current adventures ordered by the next relevant start date, undated ideas next, archived trips accessible separately. A rich preview shows route/places and progress. Do not invent exact dates.
2. **Adventure overview:** At-a-glance journey shape, route-map preview, duration or approximate dates, traveller group, destination-night spans, important transfers, booked anchors, and only meaningful planning questions. Clean, attractive, iPhone-first. The current plan dominates; History stays secondary. Avoid dashboards of completion metrics.
3. **Journey canvas + day detail:** Show the whole trip first as a legible sequence of stops, nights and transitions; open weeks and individual days as needed. A 21-slot day canvas is an optional detailed representation, not the primary phone interface. Tentative alternatives may overlap without implying booked simultaneous travel. Members can change stay order or nights with simple touch controls and an accessible non-drag fallback; drag/resize is an optional tested enhancement. Opening days reveals activities, actual transport timing and details. Empty time is not automatically a gap.
4. **Map:** Planned and possible stops visibly distinct, linked confirmed-booking indicators, truthful route overview, and optional foreground geolocation with consent. Selecting a place highlights its itinerary entry; selecting an itinerary entry opens the same place. Never display a speculative connection as a verified transportation service. Apple Maps handoff for directions. No continuous background GPS history in V1.
5. **Bookings and documents:** External confirmations are **anchors** distinct from editable itinerary intentions. Hotels, flights, transport and activities have structured dates/statuses, location relationships, and an accessible protected original email/paste/image/PDF/source when available. Changing the local plan must not imply the booking provider was changed. Clicking a hotel on its date or map pin opens the same booking card and original. Prioritize essential offline access during travel.
6. **Add naturally:** A single text/image/document input for places, ideas, changes and confirmations; optional direct manipulation and simple forms. AI does the organizing, avoids duplicate records, identifies ambiguity and reports concise changes with Undo. No obligatory chat session.
7. **AI Feedback (on demand):** Review the current itinerary for genuine conflicts, missing confirmed nights, overlaps, inefficient travel, unsuitable pace, questionable assumptions and meaningful alternatives. Explain the trade-off and evidence. Draft a preview and apply with one tap when either member chooses. No recurring background reviews by default.
8. **Research (on demand):** Search permitted current sources, including travel sites, independent guides, official operators and community discussions such as Reddit where access is authorized. Make recommendations tailored to travellers and trip context, not demographic stereotypes. Show why a suggestion fits, likely time/transfer cost, warnings, uncertainty, source links and dates accessed. Do not invent availability, confirmed facts or quotations. Do not bulk scrape/rehost user content or promise an integration before its terms/costs are checked.
9. **Archive:** Retain the plan, original sources, history and short optional lessons (what worked, what to do differently). These can inform later suggestions when relevant. A scrapbook/gallery or retrospective memory-generation experience is not a core function. Follow the separately approved [Low-Cost Backup & Archive Policy](BACKUP-ARCHIVE-POLICY.md): keep an accessible small archive index in Justelle and seal full completed-trip archives with verified independent copies, rather than endlessly re-copying unchanged originals.

## Authoritative collaboration and trust rules

- Two members have equal edit rights; **no second approval, no locked shared decisions, no pending workflow**. A member's edit changes the current plan immediately, with author and time in History. A history entry does not imply the other member endorsed a change.
- A **booked anchor** means an external reservation has been reported/verified, not that a member has locked a shared decision. Any member can change the displayed plan; affected bookings remain unchanged until a separate actual confirmation is supplied or corrected. Highlight mismatches.
- Human instructions that identify an unambiguous edit may be applied by the app after validation. AI-generated optional itinerary changes are previews until a member selects Apply. No AI may silently remove an item, change confirmed bookings, purchase travel, or claim an external cancellation.
- Mutate the plan snapshot and append a complete before/after change event **atomically** with server-controlled authorship/time, stable provider-independent identifiers and revision checks. Competing writes cannot silently clobber each other. Undo itself creates a new event; no prior event is deleted.
- Preserve source documents, screenshots and human entries independently from AI-extracted interpretations. The current view is a projection; audit and sources are permanent. Record possible/planned/booked/cancelled distinctions, partial dates, local travel time zones, and planned vs actual where relevant.
- Allow personal and per-adventure preferences, traveller group and interests, relevant food requirements, and reusable lessons. Preferences are editable evidence, not automatically assumed demographic traits. Do not mix information from other projects into Justelle.
- Use deterministic application logic for span and booking conflicts, with AI interpreting those results. For research output, save source URLs, retrieval date and confidence/limitations; material unsupported claims must not masquerade as findings.

## Technology ownership and adoption policy

**Standing architectural decision:** Follow [Build, Borrow and Replace](BUILD-BORROW-REPLACE.md) before implementing or selecting a new capability. Prefer reusing existing suitable code, then trustworthy maintained open-source components, then managed specialist services when those reduce maintenance or improve trustworthy data; custom-build only Justelle-specific UX, domain logic, permissioned AI action handling, booking/source relationships and portable audit records.

Keep a **small, nimble canonical core** and simple replaceable adapters at real external boundaries (AI, research, mapping/place/route data and document imports). Never implement a speculative universal plugin manager, download unknown modules to run dynamically, or make a provider's data format the owner of the adventure. Evaluate dependencies and vendor APIs for licence, privacy, maintenance, cost in CAD, device performance, portability and recovery before adoption.

Candidates to **evaluate, not blindly install**, include Svelte for the evolving planner UI, interact.js for optional touch rearrangement, MapLibre for map rendering, a managed map/place provider, PDF.js for documents, and minimal date/offline libraries where needed. Reuse the Firebase, protected media, replaceable AI and encrypted recovery work already done. Current AI web search is **not activated or included automatically** in the old model-only spend approval.

## Implementation boundaries

Retain the Firebase-first model (Auth, Firestore, member-protected Storage, bounded server-side replaceable AI), independent encrypted backup/restore, and automatic qualified private deployment strategy. Avoid building a generic knowledge graph, autonomous agent platform or bespoke navigation engine. Place/research/map vendors must be replaceable; Justelle owns the canonical plan and history.

Build under fictional data until hosted member/media protection, backup restore, service controls and physical iPhone qualification are verified. No real trip details, account identities, credentials or travel documents in this **public repository**. New maps, search, document conversion or AI spend requires checking approved provider limits and terms. The public homepage remains completely unchanged.

### Domain model starting point

- **Adventure:** stable ID, title, date/duration, travellers, planning/archived status.
- **Place + city stay:** stable place ID/coordinates where known; span of days/nights, possible/planned state; may appear across trips.
- **Plan item:** day-specific visits, travel segments and experiences; future typed expansion.
- **Booking:** separate external reservation with status, actual dates, linked destination and protected original/source. A booked anchor is never silently moved by rearranging a city block.
- **Source and recommendation:** original message, image, PDF, email or link with extraction provenance and source freshness; research suggestions remain distinguishable from current plan.
- **Change event:** append-only author/time/type/before/after chain for plan edits, amendments, undo and archiving.
- **Lesson / preference:** optional archived-trip feedback and reusable user preferences, with source/context and per-trip overrides.

`private-app/web/itinerary-core.mjs` defines provider-independent planning operations. Firestore transactions, immutable events, protected booking documents, portable recovery and a visible planner are implemented in source; maps, full provider-assisted planning and hosted acceptance remain incomplete. Consult [Where We Are](WHERE-WE-ARE.md) for current evidence rather than inferring deployment from this specification. Keep events separate from the current snapshot; do not accumulate indefinite history in one Firestore document.

## Next implementable vertical slice and exit checks

1. Integrate model with Firestore member-authorized transactional writes and Rules; reject outsiders, forged authors/events, stale versions and cross-adventure links. Preserve the older pilot records until an explicitly tested migration is available.
2. Extend canonical portable export, encrypted backup and independent recovery to **all** new plan types, booked anchors, change events and source relationships before real-data entry.
3. Replace the chat-first private view with an upcoming-first adventure list, a **journey-first** city/night/transition overview and progressively accessible day/weekly detail; show possible/planned distinction, a city anchor, a booking mismatch and change History on iPhone.
4. Add basic map/itinerary-linked place navigation and protected booking card/source retrieval. Start with manual text/screenshot entry; qualify PDFs/imports before activation.
5. Introduce typed AI interpretation/edit previews and explicit on-demand feedback/research with test fixtures, source links, cost controls and tamper-resistant tool permissions.
6. Verify multi-member concurrent moves, undo integrity, DST/cross-time-zone dates, booking mismatch, safe media/document access, provider-neutral restoration, accessibility, mobile performance, offline essentials, and hosted/device acceptance.

**First usable proof:** Two fictional members start an adventure from a short idea (21 days is one scenario), see the whole journey without a mandatory grid, add and move a city-night block, save a separate booking anchor, see an actionable mismatch, Undo and inspect attributable History. Map/day/booking views agree; protected original and independently restored archive preserve the full record. No homepage change. UX tests and broader mature-product criteria are defined in [Mature Product Vision](PRODUCT-VISION.md).
