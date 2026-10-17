> **Private-app product pivot — 17 October 2026:** [Adventure Planner V1](ADVENTURE-PLANNER-V1.md) is the active product authority, with [open-source-first build/borrow rules](BUILD-BORROW-REPLACE.md). The older chat-first, mutual-approval and scrapbook descriptions below are historical. Keep the Firebase/private media/portable recovery foundations and unchanged public homepage.

# Justelle project brief

Established October 10, 2026 from the owner's direction and repository inspection.

## Historical original direction (10–11 October)
Justelle originally combined a simple public homepage with private memories, stories and general shared-life planning. **This is superseded for the private app by the adventure-first planner above.**

Public categories: Justelle branding, approved illustrations, first names, relationship milestones, and broad trip destinations and months. Memories, stories, personal photos and detailed planning remain private by default unless specifically approved for publication.

Preserve the established “Justelle. Still us.” identity, approved illustration, calm teal/ocean styling and warm, playful, charming tone. Retain Newfoundland/Signal Hill influences where appropriate. Use Canadian English and prioritize phones and accessibility.

## Verified baseline
- Repository: [justinpfisher/justelle](https://github.com/justinpfisher/justelle), default branch `main`; public.
- `CNAME`: `justelle.life`.
- `index.html`: self-contained HTML/CSS/JavaScript, with no external dependencies or build step.
- Approved illustration asset: `justelle-caricature.png`.
- Together since August 11, 2006; married since June 24, 2011.
- Date calculations and annual greetings use `America/Toronto`.
- Upcoming cards: Calgary, July 2027; Philippines, March 2028.
- Past trip months leave the upcoming section; the source does not infer completion.
- README describes opening `index.html` for preview.

These are source findings. Live deployment was not independently verified during this inspection.

## Private-area requirements
Private content must stay outside public repository history, branches, issues, logs and deployment output. Protect records, images and downloads as well as pages. An unlisted link or browser-only password is insufficient.

Authentication, authorization, private storage, editing and backup arrangements are not deployed. Firebase Authentication, Firestore and protected Firebase Cloud Storage are now the preferred first-release path, subject to proper configuration, testing and billing approval. Initially assume access is for the couple only; do not invite additional users without direction. Exact login identities and access rules remain to be established.

Keep the existing public site. The fictional Cloudflare/Firebase comparison is in [draft PR #2](https://github.com/justinpfisher/justelle/pull/2); its emulator/browser results are not evidence of a live private deployment. No hosting migration, new paid service or real private-data ingestion is authorized by this brief.

## Historical private first-release scope (October 11, 2026; superseded)

The owner has confirmed a Firebase-first, mobile Home Screen experience for the couple, persistent sessions without routine reauthentication, one shared AI-assisted conversation, **first-class screenshots/images** (maps, restaurants, menus and similar material), low-friction ideas and plans, explicit two-person agreement before a decision becomes locked, preserved source history, and a provider-neutral export and restore path.

Photo galleries, bulk Apple Photos synchronisation and automatic album imports are deferred. Ordinary image attachments are not deferred. Privacy means genuine member-only pages, records and direct image access; the product is not being designed around repeated Face ID prompts or elaborate unlocked-device scenarios.

See [Private app V1 decisions](PRIVATE-APP-V1.md) for scope, safeguards, pilot criteria and remaining implementation decisions.

## Delivery sequence
1. Establish project instructions and repository guidance.
2. Verify and document current hosting and preview; introduce proportionate checks for public behaviour.
3. Select private access, storage, editing and backup arrangements.
4. Implement and verify the private foundation using non-sensitive sample data, including direct-request access checks.
5. Add an initial memory collection and shared planning area from supplied material.
6. Expand based on use while retaining a simple homepage.

## Maintenance
Follow `AGENTS.md` for repository work. Use focused branches, proportionate checks and clear deployment reporting. Reuse Stammtisch's useful maintenance practices without copying its features, content or credentials. Add recurring work only when requested.

Update this brief when decisions or implementation status change. Record assumptions as assumptions; do not describe planned functionality as operational.
