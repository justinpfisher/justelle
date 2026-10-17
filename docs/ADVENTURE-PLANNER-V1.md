# Justelle — Adventure Planner V1 direction

**Approved product direction: 17 October 2026 (America/Toronto).**

**Authority:** Latest owner decisions. This document supersedes the chat-first experience, mandatory two-member agreement/approval, and memory-scrapbook objectives in the 11 October private-app specification. Those earlier documents and tests remain historical evidence, not the current product's acceptance criteria. The existing public site at justelle.life is unchanged; develop the private experience separately at app.justelle.life.

## Product purpose

Justelle is a private, AI-assisted **adventure planner** for two equal members. It should remove planning administration, improve travel decisions and retain trustworthy source/history records. It is not a replacement for personal messaging, photos or souvenirs.

An adventure begins as a blank, configurable day canvas (21 days is an example, not a forced default for every trip). The two members layer in destinations, city stays, tentative experiences, transportation and bookings. Both members can directly or naturally edit the **current plan immediately**. Prior versions and attributable changes are preserved. Completed adventures are archived primarily for reference and useful lessons, not reminiscence or photo-journaling.

## First-release interaction

1. **Home:** Upcoming/current adventures ordered by the next relevant start date, undated ideas next, archived trips accessible separately. A rich preview shows route/places and progress. Do not invent exact dates.
2. **Adventure overview:** Route-map preview, trip duration, travellers, key city blocks, confirmed travel anchors, open planning questions, and quick entry. Clean, attractive, iPhone-first. The current plan dominates; History stays secondary.
3. **Day canvas + timeline:** Whole-trip overview showing 21 blank day slots for a 21-day trip; focus on weeks/days on phones. City/overnight stays occupy spans of nights; possible destinations can overlap as alternatives. Members can move and resize tentative city blocks and open individual days for activities, travel and details. Empty time is not automatically a gap.
4. **Map:** Planned and possible stops visibly distinct, route overview, optional foreground geolocation when permission is granted. Selecting a place highlights its itinerary entry; selecting an itinerary entry opens the same place. Apple Maps handoff for directions. No continuous background GPS history in V1.
5. **Bookings and documents:** External confirmations are **anchors** distinct from editable itinerary intentions. Hotels, flights, transport and activities have structured dates/statuses, location relationships, and an accessible protected original email/paste/image/PDF/source when available. Changing the local plan must not imply the booking provider was changed. Clicking a hotel on its date or map pin opens the same booking card and original. Prioritize essential offline access during travel.
6. **Add naturally:** A single text/image/document input for places, ideas, changes and confirmations; optional direct manipulation and simple forms. AI does the organizing, avoids duplicate records, identifies ambiguity and reports concise changes with Undo. No obligatory chat session.
7. **AI Feedback (on demand):** Review the current itinerary for genuine conflicts, missing confirmed nights, overlaps, inefficient travel, unsuitable pace, questionable assumptions and meaningful alternatives. Explain the trade-off and evidence. Draft a preview and apply with one tap when either member chooses. No recurring background reviews by default.
8. **Research (on demand):** Search permitted current sources, including travel sites, independent guides, official operators and community discussions such as Reddit where access is authorized. Make recommendations tailored to travellers and trip context, not demographic stereotypes. Show why a suggestion fits, likely time/transfer cost, warnings, uncertainty, source links and dates accessed. Do not invent availability, confirmed facts or quotations. Do not bulk scrape/rehost user content or promise an integration before its terms/costs are checked.
9. **Archive:** Retain the plan, original sources, history and short optional lessons (what worked, what to do differently). These can inform later suggestions when relevant. A scrapbook/gallery or retrospective memory-generation experience is not a core function.

## Authoritative collaboration and trust rules

- Two members have equal edit rights; **no second approval, no locked shared decisions, no pending workflow**. A member's edit changes the current plan immediately, with author and time in History. A history entry does not imply the other member endorsed a change.
- A **booked anchor** means an external reservation has been reported/verified, not that a member has locked a shared decision. Any member can change the displayed plan; affected bookings remain unchanged until a separate actual confirmation is supplied or corrected. Highlight mismatches.
- Human instructions that identify an unambiguous edit may be applied by the app after validation. AI-generated optional itinerary changes are previews until a member selects Apply. No AI may silently remove an item, change confirmed bookings, purchase travel, or claim an external cancellation.
- Mutate the plan snapshot and append a complete before/after change event **atomically** with server-controlled authorship/time, stable provider-independent identifiers and revision checks. Competing writes cannot silently clobber each other. Undo itself creates a new event; no prior event is deleted.
- Preserve source documents, screenshots and human entries independently from AI-extracted interpretations. The current view is a projection; audit and sources are permanent. Record possible/planned/booked/cancelled distinctions, partial dates, local travel time zones, and planned vs actual where relevant.
- Allow personal and per-adventure preferences, traveller group and interests, relevant food requirements, and reusable lessons. Preferences are editable evidence, not automatically assumed demographic traits. Do not mix information from other projects into Justelle.
- Use deterministic application logic for span and booking conflicts, with AI interpreting those results. For research output, save source URLs, retrieval date and confidence/limitations; material unsupported claims must not masquerade as findings.

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

The new provider-independent private-app/web/itinerary-core.mjs establishes a **first pure-model slice**: blank day canvas, movable possible/planned stays, independent booking anchors, basic deterministic mismatch signals, archive lessons, sort order and undo/change events. It does **not** yet connect to Firestore, export/recovery, AI, maps or the visible application. Do not represent it as a deployed planner. Production persistence must store immutable events separately from the current snapshot; do not accumulate indefinite events in a single Firestore document.

## Next implementable vertical slice and exit checks

1. Integrate model with Firestore member-authorized transactional writes and Rules; reject outsiders, forged authors/events, stale versions and cross-adventure links. Preserve the older pilot records until an explicitly tested migration is available.
2. Extend canonical portable export, encrypted backup and independent recovery to **all** new plan types, booked anchors, change events and source relationships before real-data entry.
3. Replace the chat-first private view with the home adventure list and real editable day/weekly canvas; show possible/planned distinction, a city anchor, booking mismatch and change History on iPhone.
4. Add basic map/itinerary-linked place navigation and protected booking card/source retrieval. Start with manual text/screenshot entry; qualify PDFs/imports before activation.
5. Introduce typed AI interpretation/edit previews and explicit on-demand feedback/research with test fixtures, source links, cost controls and tamper-resistant tool permissions.
6. Verify multi-member concurrent moves, undo integrity, DST/cross-time-zone dates, booking mismatch, safe media/document access, provider-neutral restoration, accessibility, mobile performance, offline essentials, and hosted/device acceptance.

**First usable proof:** Two fictional members create a 21-day adventure, add and move a city block, save a separate booking anchor, see an actionable mismatch, undo and inspect attributable History; map/day/booking views agree; protected original and restored archive preserve the full record. No homepage change.
