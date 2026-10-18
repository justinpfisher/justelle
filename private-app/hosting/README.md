# Private hosting source

[OPERATIONS.md](OPERATIONS.md) is the authoritative configuration, initial qualification, recurring release and recovery runbook. This page is a source map, not a second checklist.

- `firebase.json` and `firebase.production.json`: isolated fictional/production Hosting targets, deny-all direct Storage rules, Firestore rules/indexes and second-generation Functions codebase `gateway`.
- `functions/index.mjs`: `privateApi` (authenticated AI/media gateway) and `encryptedBackup` (scheduled encrypted recovery), each with separate identity/secrets.
- `deployment-config.mjs`: validates separate projects and origins; production client mode is implemented.
- `deploy.mjs` / `release-core.mjs`: package, deploy, smoke-check, record known-good source and recover previous source without rewinding private data.
- `smoke.mjs`: bounded post-release version, both-member access and anonymous-denial checks; no paid generation or private writes.
- `accept-hosted.mjs`: stronger fictional security/integrity/live-provider/B2 checks when affected assurances change or for initial setup.
- `qualify.mjs`: read-only existing-fixture HTTP checks; optional diagnostic tool, not an extra mandatory release stage.
- `iphone-acceptance.md`: initial real-device checks, repeated only for affected phone behaviour or observed regression.

The public root site is separate. Prepared source and passing CI do not prove deployed projects, IAM, B2, devices or production automation are configured.
