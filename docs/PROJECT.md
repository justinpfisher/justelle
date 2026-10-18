# Justelle project brief

Justelle is a private, adventures-first planner for two members, with a separate minimal public homepage. The approved mature journey-first experience and smaller first release are defined in [Product Vision](PRODUCT-VISION.md) and [Adventure Planner V1](ADVENTURE-PLANNER-V1.md). Both members can edit immediately with history and Undo; planning never silently changes supplier bookings. The October 11 chat-first and mandatory two-person approval design is retired.

## Where to look

- [Where We Are](WHERE-WE-ARE.md): current milestone evidence and release state, also displayed on the repository homepage. Source tests do not establish a live private service.
- [AGENTS.md](../AGENTS.md): instruction precedence, standing release authority and proportionate verification.
- [Operations](../private-app/hosting/OPERATIONS.md): one-time setup, recurring releases, secrets and recovery.
- [Private-app README](../private-app/README.md): local development commands.
- [Build, Borrow and Replace](BUILD-BORROW-REPLACE.md): reuse and provider decisions.
- [Backup & Archive Policy](BACKUP-ARCHIVE-POLICY.md): independent recovery and completed-trip preservation.
- [Approved account and spending decision](production-launch-decision.md): continuing authority and limits.

The source baseline is `main`; future work branches from it rather than maintaining mirrored product documents on a permanent development branch. Keep `index.html`, `CNAME` and approved public illustration unchanged during private-app work. Private data, credentials and recovery material stay outside this public repository. Public/home date facts remain in the homepage source; do not copy obsolete planned dates into new requirements.

Historical specifications and launch estimates are retained under `docs/history/` and in Git history, clearly separated from operative instructions.
