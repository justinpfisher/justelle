# Justelle repository instructions

## Purpose and authority
Maintain https://justelle.life/ from `justinpfisher/justelle`, default branch `main`. Read [the project brief](docs/PROJECT.md) and relevant source before changing behaviour. The latest explicit user direction governs scope and publication.

Justelle is a simple personal homepage with a planned private space for milestones, adventures, shared memories, stories, photos, trip planning and shared activities.

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
Keep static HTML/CSS/JavaScript while it meets the requirement. The current site has no build step or external dependencies. Add a protected service only when needed for private features; explain costs and account/maintenance requirements before selecting a new service.

Keep Justelle separate from Stammtisch and other projects. Reuse useful setup, preview, verification and documentation practices, not their content, credentials or publishing pipelines. Do not introduce recurring automation without a request.

## Workflow and verification
Work in focused branches and pull requests. Complete authorized tasks without repeated confirmation; ask when missing information materially changes the outcome or the work introduces new spending, an audience expansion, or publication of unapproved personal content. Merge and publish only within the active task's authorization.

For documentation-only changes, verify consistency with current source and the changed-file scope. Do not add tests that merely repeat documentation.

For behaviour changes, verify relevant outcomes. Date logic checks should cover Toronto midnight, anniversary boundaries, leap years, daylight-saving transitions and trip-month rollover where affected. UI changes should be checked on phone and desktop sizes, with keyboard access, meaningful image descriptions and a readable fallback if JavaScript fails. Document actual commands as checks are introduced.

Keep private originals, credentials and sensitive diagnostics out of test fixtures and build output. For private features, test both successful access and rejection of unauthenticated and unauthorized direct requests.

Inspect relevant existing changes; avoid overwriting unrelated work. Report what changed, why, what was checked and material limitations. Distinguish committed source, merged source and verified live publication.

Do not add compulsory execution-mode selection, model-verification gates, launch restrictions or any version of the discontinued Universal Autonomous Advancement Protocol.
