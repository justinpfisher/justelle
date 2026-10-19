# Justelle. Still us.

<!-- JUSTELLE_MILESTONE_STATUS_START -->

## Where we are — Justelle project

**Private app: NOT VERIFIED LIVE.** Source and emulator tests do not constitute hosted/iPhone acceptance. **2/8 milestones accepted**, including a development-only foundation; **1/4 V1 delivery milestones accepted**.

**Now:** [M2 — Journey-first iPhone planner](https://github.com/justinpfisher/justelle/issues/22). Next acceptance: Map/place/day selections agree with the same canonical itinerary; tentative routes are never portrayed as confirmed transport.

| Milestone | Horizon | Criteria | Status |
| --- | --- | ---: | --- |
| [M0 — Development foundation](https://github.com/justinpfisher/justelle/issues/20) | Foundation | 5/5 | Complete |
| [M1 — Shared records and recovery](https://github.com/justinpfisher/justelle/issues/21) | V1 | 6/6 | Complete |
| [M2 — Journey-first iPhone planner](https://github.com/justinpfisher/justelle/issues/22) | V1 | 3/6 | Current |
| [M3 — Controlled AI planning](https://github.com/justinpfisher/justelle/issues/23) | V1 | 0/5 | Upcoming |
| [M4 — Secure iPhone production launch](https://github.com/justinpfisher/justelle/issues/24) | V1 | 0/6 | Upcoming |
| [M5 — Travel-day essentials and discovery](https://github.com/justinpfisher/justelle/issues/25) | Later | 0/5 | Upcoming |
| [M6 — OneDrive archives and efficient backups](https://github.com/justinpfisher/justelle/issues/26) | Later | 0/6 | Upcoming |
| [M7 — Mature usability and sustainability](https://github.com/justinpfisher/justelle/issues/27) | Later | 0/5 | Upcoming |

**[Detailed status and verification boundaries](docs/WHERE-WE-ARE.md)** · [Implementation and release issue #4](https://github.com/justinpfisher/justelle/issues/4)

Updated automatically from evidence checklists and milestone issue state. Recorded acceptance is not a separate live-system test. The public [justelle.life](https://justelle.life/) homepage is unchanged.

<!-- JUSTELLE_MILESTONE_STATUS_END -->

A small personal page at [justelle.life](https://justelle.life/).

Open `index.html` in a browser to preview. Development and affected private-app checks should run on the GMKtec first; the independent public-repository CI remains GitHub-hosted for security (see [AGENTS.md](AGENTS.md)). The page has no build step or external dependencies.

The time together is calculated from August 11, 2006; the time married from June 24, 2011. Both use calendar dates in Toronto, including annual anniversary greetings. Dates remain readable if JavaScript is unavailable.

Upcoming trips live in the `trip-list` in `index.html`. Each trip's `data-plan-month` and `<time datetime>` use `YYYY-MM`; update these together with its visible destination and date. Trips stay visible through their planned month, then leave the upcoming section automatically. Month counts refer to calendar months, without assuming a departure day.

The memory section is deferred until there is a memory to share.
