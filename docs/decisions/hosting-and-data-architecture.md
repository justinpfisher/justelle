# ADR: Hosting and data architecture

**Date:** 2026-10-11  
**Status:** Accepted direction; implementation and production qualification remain incomplete.

## Decision

Keep the public Justelle homepage at [justelle.life](https://justelle.life/) on GitHub Pages, with source and deployment managed through the GitHub repository. Keep the existing static page simple. Build the planned private couple’s app as a separate mobile web experience, using Firebase Authentication for individual sign-in, Firestore for shared persistent records, and private Cloud Storage for screenshots and images.

This is a first-release preference, not an assertion that the private service is deployed or production-ready. Keep private data outside Git history, public Pages output, issues, logs, and public assets. The repository stores code and fictional fixtures only.

## Product and access requirements

- Use two distinct adult accounts. Each person signs in as themselves; shared access comes from explicit membership and authorization, not shared credentials.
- On a trusted iPhone, preserve a secure session so ordinary Home Screen openings do not require routine sign-in. Firebase’s web SDK supports local session persistence by default, but actual Safari and Home Screen behavior, security trade-offs, and recovery must be verified on the target iPhones before production.
- Protect both records and direct image/file retrieval with authentication and authorization. Avoid public or long-lived retrievable media URLs. Test unauthenticated and non-member direct requests against the hosted service.
- Keep a provider-neutral export and independent restore path for messages, decisions, attachments, metadata, relationships, and checksums. Firebase’s managed Firestore export is one operational tool, not by itself proof of a complete portable backup: it requires billing, writes to Cloud Storage, and does not include index definitions. Verify restore outside Firebase before storing real memories.
- AI output remains a proposal. It must never overwrite a confirmed decision or bypass explicit attributable agreement by both members. Preserve history when an agreed decision is revised.
- Keep canonical records and stable Justelle identifiers separate from Firebase account IDs so identity, storage, and AI providers can change independently.

## Hosting alternatives

ChatGPT Sites is **not selected for production hosting**. OpenAI currently describes Sites as a public beta with plan/workspace-dependent limits and access controls. Its current terms prohibit Sites designed for children under 13 (or the applicable age of digital consent). Future reconsideration requires checking current terms, audience suitability, privacy and access behavior, export/restore, custom-domain support, operational limits, and migration options; none of those should be inferred from “hosted” availability. No Sites pricing or data-portability guarantee is assumed.

ChatGPT Work and Codex are development and research tools. Their use does not make either product part of the production hosting or data architecture.

## Cost and operational qualification

A roughly **C$0 infrastructure baseline is only a possibility**, not a quote or guarantee. It depends on workload and current no-cost quotas for GitHub Pages and Firebase products. Cloud Storage for Firebase currently requires the Firebase Blaze pay-as-you-go plan, even when usage may fall within a no-cost allowance; billing must therefore be enabled and overages can incur charges. Set a budget alert, review current regional pricing and quotas, and approve a cost boundary before enabling billing or adding real accounts/data. Budget alerts do not cap charges.

The app also needs an independently recoverable encrypted backup destination and a tested restore procedure. Choose the final login provider, custom domain, billing boundary, backup destination, and recovery owner before activating real accounts or importing personal content.

## Evidence and limits

Confirmed from repository source: the homepage is a self-contained static page with no build step; the public Pages source is this repository; the private app is still planned. Existing project notes describe a fictional-data prototype, not hosted Firebase, production security, actual iPhone behavior, live AI, or independent production recovery. Those remain qualification work.

Official references checked 2026-10-11:

- [Creating and using ChatGPT Sites](https://help.openai.com/en/articles/20001339-creating-and-using-chatgpt-sites) — availability, beta limits, sharing, and custom domains.
- [ChatGPT Sites Terms](https://openai.com/policies/chatgpt-sites-terms/) — audience restrictions and publisher responsibilities.
- [Firebase Auth state persistence](https://firebase.google.com/docs/auth/web/auth-state-persistence) — available web persistence modes and default behavior.
- [Cloud Storage for Firebase web setup](https://firebase.google.com/docs/storage/web/start) — Blaze plan requirement.
- [Firebase pricing](https://firebase.google.com/pricing) — current plan allowances and usage pricing.
- [Firestore export and import](https://firebase.google.com/docs/firestore/manage-data/export-import) — billing, export scope, and restore limitations.
- [Cloud Firestore usage and limits](https://firebase.google.com/docs/firestore/quotas) — quotas and billing-dependent features.
- [GitHub Pages limits](https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits) — published-site size and soft bandwidth limits.

Recheck all vendor terms, quotas, and prices before launch; they can change.
