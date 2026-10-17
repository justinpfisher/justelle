# Justelle — mature adventure-planning product vision

**Approved end goal: 17 October 2026 (America/Toronto).**  
**Scope:** Private, iPhone-first adventure application for two equal members. This is the **long-term product north star**, not a claim that the experience is implemented, live, funded, or included in the next release.

## Authority and decision boundaries

- This document records the owner's comprehensive UX/product review as Justelle's desired **mature outcome**. It complements [Adventure Planner V1](ADVENTURE-PLANNER-V1.md), which specifies the first implementable release and security/qualification requirements. [Build, Borrow and Replace](BUILD-BORROW-REPLACE.md) controls implementation choices. Latest explicit owner decisions supersede any document.
- **Committed product principles** below should guide every release and be preserved as the application evolves. **Interface hypotheses** (exact number/labels of tabs, a vertical journey ribbon, image sizes, drag gestures, colours and tap-count targets) should be validated on real iPhones and improved when evidence supports a better design; do not freeze a mockup as a requirement.
- Earlier chat-first, mandatory two-person sign-off, locked agreements, scrapbook/gallery, general household app and calendar-grid-first directions do not govern the private planner. Preserve working access control, media protection, source/audit integrity, deployment safeguards and independent recovery from the earlier pilot.
- Public justelle.life and its warm identity remain unchanged; the private product is separate at app.justelle.life. This vision does not authorize paid provider activation, broaden private access, or waive hosted/real-device acceptance.

## One-sentence outcome

**Justelle makes an adventure take shape naturally.** Either member can capture an idea, shape a route, change a stay, save a genuine booking, examine a recommendation, or retrieve today's essentials in seconds—without managing project workflows or holding a chatbot conversation.

It must be visually inviting and efficient, yet grounded in dependable dates, original evidence, member-only access, reversible edits, and provider-independent long-term history.

### What people should experience

1. **Imagine:** Save a destination, rough duration, time window, or passing thought with a single natural entry. No required questionnaire, exact date, category or itinerary generation.
2. **Shape:** Understand the whole journey immediately: destination stays, nights, major travel transitions, possibilities and unallocated time. Move between whole trip, week and day without losing context.
3. **Explore:** Save unscheduled possibilities without inventing dates. Compare a few personally relevant, evidence-backed choices, including effort, location, drawbacks and source quality. Move a choice into the journey directly.
4. **Confirm:** Import or enter bookings and access original confirmations. External booking facts are independent anchors, not just visually locked itinerary items.
5. **Go:** When travel is underway, Today's next commitment, tickets, hotel, directions, essential itinerary and offline status take precedence over editing and research.
6. **Reuse:** Completed adventures remain reliable reference records. Optional lessons inform future planning; journaling and photo albums are not required.

None of these are mandatory workflow stages or status-approval queues.

## The interaction model: journey, possibilities and essentials

**Journey** is the principal visual representation of the current plan. **Possibilities** are worthwhile unscheduled ideas and competing alternatives. **Travel essentials** are bookings, original confirmations and immediately useful operational details. These are perspectives on one adventure, not separate systems users must reconcile.

### Journey, not a compulsory 21-day grid

- **Primary whole-trip view:** A clear, proportionate sequence of overnight destination stays and travel transitions, with route/map context. Call this the *journey shape*; 21 days is an example, not a compulsory default or 21 tiny touch targets.
- **Overnight stays use nights:** An arrival day, departure day, overnight flight and three hotel nights are different concepts. Dates and local time zones remain accurate. Transportation and transfer burden should be visible.
- **Progressive detail:** Whole journey first; expandable week/date ranges next; individually editable day/time entries last. Sparse days are legitimate free time and must not be presented as incomplete tasks.
- **Adapt to scale:** One-day outings emphasize activities; weekends emphasize a short stay; multi-week trips emphasize route, regions, nights and transitions. No need to create a full city/country itinerary for a local outing.
- **Possible is not planned:** Tentative stops and unscheduled ideas may coexist or compete without implying simultaneous reservations. Committed intended stays should not silently overlap in impossible ways.
- **Mobile editing:** Tap an overnight block to move it, adjust nights, add an experience or see details; offer reliable explicit buttons and a keyboard/screen-reader path. Dragging is an optional convenience, never the only way.
- **Consequential changes:** If added nights require shortening another stay, extending travel or conflicting with a booking, ask a single concrete contextual question or show a focused preview. Do not silently compress other stops, change a purchased itinerary or make up transport.

### Connected, consistent perspectives

The same stable place, stay, journey item, travel segment and booking must appear consistently in the overview, days, timeline, map, Today and original-source detail. Selecting a map marker opens its itinerary/place context, and selecting the itinerary can focus its map location. A simplified phone interface and larger-screen timeline can differ in presentation without differing in facts.

A suggested mobile information architecture is **Journey / Explore / Map**, with **Today** prioritized during active travel. Bookings/documents, AI Feedback and History should be contextual, readily accessible, but not permanent competing top-level tabs. Test the precise IA rather than enforcing it by decree.

## Screen-by-screen mature experience

| Surface | First thing it must communicate | Primary interaction and deliberate omission |
| --- | --- | --- |
| **Home** | Next upcoming/current adventure, with cover/route, dates if known and participants; undated ideas next, archive separate | Open the trip or create from a sentence. No dense KPI dashboard or completion scores |
| **Adventure overview** | Route, duration/uncertainty, traveller group, main stays, confirmed travel anchors and outstanding meaningful questions | Open timeline/map, add naturally, see contextual essentials. History stays secondary |
| **Whole-journey canvas** | Relative night allocation, travel transitions, booked constraints, alternatives and truly open time | Move or resize unbooked stays, expand week/day; no 21-column mandatory phone grid |
| **Day** | Local date, overnight base, confirmed timed commitments, flexible activities and realistic movements | Reorder/adjust intended activities, open source or directions; don't invent precise times |
| **Map** | Route shape, possible/planned places, booked indicators and selected day's geography | Tap pins linked to the same place/booking; never render speculative lines as verified transport |
| **Place / booking** | Place: reason for interest and fit. Booking: supplier, actual date/time, status, confirmation, original | One-tap save/place/move; booking source and actions immediately available, with expanded fine detail |
| **Explore / research** | A few strong image-led options with why they fit, travel effort, drawbacks and dated source links | Save as idea, compare effect on route or add to day; no endless generic feed |
| **AI Feedback** | Only material conflicts, pacing or transfer problems, evidence and concise proposed remedies | View affected item and before/after changes, then Apply or dismiss. No unsolicited recurring audits |
| **Today** | Next booked commitment, hotel, ticket/QR, directions, remaining day and tomorrow | Fast practical retrieval, localized times, clear offline state; editing/research secondary |
| **Archive** | Retained plan, actual confirmations/source history, optional meaningful lessons | Consult, reuse, correct a lesson; no mandatory scrapbook or daily journaling |

## AI is an organizational assistant, not the principal interface

Natural language, pasted text, screenshots, PDFs, direct manipulation and manual input are equivalent ways to contribute. The default output of a simple task is a changed **visual plan**, not lengthy assistant prose.

**Action policy, governed by application validation:**

- **Act + Undo:** Direct, unambiguous, reversible member instructions affecting unbooked intentions; display a one-line summary and immediately available Undo.
- **Ask once:** Only when material ambiguity changes the result (for example, where three extra nights come from). Prefer a small contextual choice over multiple questions.
- **Preview + Apply:** AI-originated discretionary recommendations, broad re-routes or changes that materially affect other plans. Any confirmed-booking conflict stays visible.
- **Review extraction:** Keep the protected original, extract booking facts and highlight only uncertain/material fields. A screenshot, quote or draft must not silently become a verified booking.
- **Warn accurately:** Only when there is a genuine scheduling, timing, reservation or evidence conflict, with affected records and reasonable actions.
- **Remain silent:** Do not create routine reviews, synthetic "opportunities", congratulatory replies or reminders just to display activity.

An example: "Three nights at the stopover on the way, then home directly after the final city" changes the unbooked route when enough nights exist, summarizes the adjustment, and records the direct-return *preference*. It **does not** claim a flight is found, available, booked or changed. If confirmed flights conflict, the proposal identifies them and does not touch their external facts.

**Research contract:** Use current permitted reputable sources; distinguish operator/official facts, third-party route estimates, community sentiment and model inference. Include direct links, retrieval dates, personal relevance, drawbacks, travel/time burden, meaningful disagreement and uncertainty. Community discussion is useful qualitative evidence, not an objective popularity ranking. Limit initial results to a small useful shortlist; offer one-tap Save idea, Add to journey or Compare route impact. Do not claim live reservations without true provider confirmation. Respect provider access, cost, privacy and redistribution terms.

The AI never receives unrestricted database-writing authority. It proposes typed actions; Justelle authenticates, validates and commits them with correct provenance and atomic event history. No AI provider may own the permanent record.

## Trust, collaboration and durable record

- Either authorized member may directly edit the current plan without obtaining the other's approval. Changes become visible quickly and carry server-attributed author, time, source, before/after values and a reversible history.
- Preserve atomic current-view/event updates, stable provider-independent identifiers and conflict-safe concurrent editing; resolve competing changes without silent overwrites. Undo is itself a new attributable change. Consider selective reversal once multiple changes follow.
- Distinguish **possible**, **intended/planned**, and **externally reported/confirmed/cancelled** states without implying that a visual itinerary edit modifies an outside supplier's reservation.
- A booking is a separately stored source-backed anchor (including actual local times/dates/status where applicable), linked to place/day/map, with original protected source. Preserve evidence and amendments, including cancellations. A user-reported or parsed booking must not acquire false verification.
- Preserve partial/approximate dates, night/day semantics, trip time zones, actual versus intended travel, booking relationships and research provenance.
- Member-specific and trip-specific preferences and explicit optional past-trip lessons help personalize research. Let members view/edit these; avoid inferring sensitive personal information from unrelated projects.
- Member-only records, documents and direct media access; protected server-side integrations; no private content or credentials in public GitHub. Durable independent encrypted export/restore retains originals, relationships, edits and history after vendor replacement.
- Offline travel essentials should be explicitly saved and accessible, with a visible freshness/availability state. Do not claim live directions or supplier changes when offline. Test actual iPhone Home Screen retention and reload behaviour.

## Visual and interaction principles

Warm, light, restrained Justelle identity: off-white surfaces, calm ocean/teal accents, readable dark text, subtle sand tones; editorial warmth without corporate admin styling. Prefer beautiful adventure covers and meaningful destination research images over galleries of every task. Strong type hierarchy and generous spacing are more important than ornate cards.

- Primary information visible at a glance; details progressively disclosed through a simple sheet, not multiple nested menus.
- Touch actions with comfortably sized targets (aim around 44 points for primary controls), screen-reader labels, contrast, dynamic text, keyboard access and reduced-motion support.
- One clear primary action per context. Distinct planned/possible/booking treatments must work without relying on colour alone.
- A loading failure or unavailable map/provider must leave the journey and booking information usable; never replace trustworthy records with guessed AI content.
- Aim for one action to save a result, short direct edits, and access to tickets/booking details in one or two interactions during travel. These are **evaluation targets**, not certified existing performance.

## What not to build merely because possible

Avoid a chat-first home, all-at-once 21-day spreadsheet on iPhone, mandatory forms/categories, mutual-approval queues, extraneous top-level tabs, itinerary completion scores, noisy notifications, perpetual AI agents, fabricated precise scheduling, itinerary-dependent changes to real bookings, complex offline sync, public social feeds, photo scrapbook/journal obligations, proprietary mapping engines, travel purchasing engines and speculative plugin marketplaces.

Keep Justelle narrow and nimble. Reuse working infrastructure first, then evaluate maintained open source and specialist services via small replaceable boundaries. Do not expand into generic household management.

## Delivery working backward from the end state

### First production-worthy adventure slice (V1)

- Upcoming-first adventures home, fast one-sentence creation with approximate/unknown dates, understandable trip overview and edit-ready journey shape.
- Real trip/overnight/day model (not just a calendar grid); manual move/change-nights fallback; distinguish possible/planned, free time, and real date/booking constraints.
- One canonical synchronized itinerary, basic route/map, day and place details. Actual booking anchors and protected originals with correction and explicit mismatches.
- Two-member immediate edits, server-authored immutable events, safe Undo, concurrency handling, source preservation and reliable portable export/recovery.
- Natural entry and basic protected image/screenshot import; typed bounded AI assistance for clear edits and *explicit* on-demand feedback. Introduce cited live research/document-import sophistication only after source, privacy and CAD spending controls qualify.
- Essential mobile accessibility, actual iPhone Home Screen qualification, authentic access controls, direct-file denial, offline priority items and hosted/restore/release acceptance. Preserve the public homepage.

This is a *scope priority*, not permission to mislabel the existing chat pilot as production-ready. V1 should demonstrate the journey-first philosophy, not implement every mature feature.

### Subsequent releases, only after demonstrated usefulness

Refine drag/resize and multi-scale timeline; higher-quality route/geographic comparison; richer permitted research with traveller trade-offs; reliable PDF/email/screenshot booking extraction and duplicate handling; more sophisticated travel-day/offline support; selective history reversal; easier reusable trip lessons. Choose order from actual friction and user demand, not competitors' feature inventories.

### Mature state

Trip planning, exploration, confirmation, real-world execution and practical learning feel continuous. Maps, days, documents and AI stay synchronized. Outside map/search/AI/storage providers remain replaceable. Every complexity addition must demonstrate a material reduction in member effort or risk.

## UX acceptance: prove ease of use, not just appearance

Use fictional, representative tasks with people unfamiliar with the interface, then physical iPhone trials for both members and at least several new-to-Justelle participants. Include small-screen and accessibility coverage. Observe without teaching participants the navigation.

1. Create a rough future adventure from one sentence without specifying dates.
2. Add three possible destinations; put two in order and allocate nights.
3. Extend a stay without accidentally moving an existing booking; resolve a conflict.
4. Save an activity from an image-led, source-backed research result in one or two actions.
5. Import a fictional ambiguous booking screenshot, correct an uncertain field and open its protected original.
6. Find the same place/booking through the route map, day view and booking detail; verify matching facts.
7. Ask AI to make a clear edit and Undo; review an AI suggestion without applying it.
8. With two members editing concurrently, recover from a conflicting change and identify who changed what.
9. With connectivity disabled, retrieve a saved hotel address, confirmation and tomorrow's plan, while recognizing what is unavailable.
10. Retrieve a ticket quickly under a simulated time-pressure scenario with realistic text scaling.

Record observed **unaided completion**, elapsed actions/time, wrong assumptions about booking status, backtracking, error recovery, and ability to explain what is booked versus merely intended. Proposed benchmark: target at least 80% unassisted completion per high-priority task in early small tests and no critical booking/trust misunderstandings; refine thresholds and retest after failures. A pretty prototype, local emulator pass or developer demonstration is not acceptance.

## Release decision test

Before shipping any feature, ask: Does this make an adventure easier to understand or change on an iPhone? Does it reduce real steps without obscuring truth? Does it preserve privacy, history, source evidence and portability? Is it more useful than a simpler alternative? Was the behaviour verified on relevant devices? If not, simplify, test or defer it.

**The end goal is not a maximal feature list. It is an exceptionally effortless, attractive, trustworthy private shared-adventure planner that remains useful through planning, travel and years of retained experiences.**
