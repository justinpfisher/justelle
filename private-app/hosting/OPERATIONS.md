# Private application release and recovery

The October 13 approval remains in force. Source preparation is not a live deployment. This checkout contains the hosted response route, production client mode, self-contained Functions packaging, scheduled encrypted B2 backup, hosted acceptance runner and automatic release/recovery orchestration. Cloud configuration and hosted qualification still have to be completed in the intended Justelle accounts.

## Technology changes and provider operations

The default selection rule is [Build, Borrow and Replace](../../docs/BUILD-BORROW-REPLACE.md). Reuse suitable verified code, evaluate maintained open-source options before bespoke work, and integrate external maps/place/research/AI/document services behind thin, independently testable boundaries. Check current licence, data-use/caching terms, private information sent, iPhone fallback, vendor replacement path, and **CAD operating cost/approved caps** before activation. No plugin marketplace, arbitrary executable extension, cross-project credential reuse or undocumented third-party upload. The old model-only AI budget does not automatically include on-demand web-search charges. Record provider choices and safe failure modes in the implementing PR; preserve isolated hosted acceptance, original protected files and independent restoration.

## One-time provider setup

Use two new Justelle-only Firebase projects, each with its own C$5/month billing alert and zero-minimum-instance Functions. Never use another project's account, credentials, identities or content. Provision Firestore and Storage in an appropriate Canadian location, with gateway and backup functions in `northamerica-northeast1`. Do not connect the qualification project to `app.justelle.life`: use its temporary `web.app` origin. Production alone uses `app.justelle.life`. Leave root DNS, root artwork, `CNAME` and the existing public publisher untouched.

Enable email/password Authentication without SMS; do not enable public member enrolment in the app. Membership requires both verified custom claims and the private room document. Store two stable person identifiers, their Auth UID mappings and display labels privately. Set `revoked_auth_before[uid]` to the session's `auth_time` (or current epoch seconds) and revoke refresh tokens to invalidate old sessions immediately in Rules and in the gateway, without deleting authorship. Existing member labels and UID mappings remain available to recovery.

Create a private, Object Lock-enabled B2 bucket with a default governance retention period and lifecycle policy agreed within the approved operating allowance. The uploader key must be restricted to that bucket and prefix: upload/read objects and inspect bucket retention, with no delete permission or governance bypass. Store only encrypted `.jmb` files. Keep a separate offline copy of the 32-byte recovery key outside Firebase and B2; verify its custody before real content. The automated key copy is a Secret Manager secret available only to the backup identity. The B2 account cannot decrypt the archive.

The API model remains the October 13 approved `gpt-5.6-luna`, with no tools, C$5/month and C$1/day application reservations. Verify model availability and current CAD rates before enabling the real key. Store the key as `JUSTELLE_AI_KEY`; store the model, `ai_enabled`, and expiring `ai_pricing` in `rooms/<room>/operations/runtime`. Pricing includes `model`, `inputCadMicrosPerMillion`, `outputCadMicrosPerMillion`, and `validUntil`. Expired or missing pricing fails closed. Set provider-side alerts too. Google budget alerts are not hard billing caps.

## Least-privilege identities

| Identity | Required access | Exclusions |
|---|---|---|
| Gateway | Auth user get for revocation; Firestore get/list/create/update in its isolated project; GCS object get/create under the room media prefix; only the AI key secret | No Auth user administration, object deletion, backup secret, B2 credential or deployment rights |
| Backup | Firestore read; original/preview object read under the room media prefix; only `JUSTELLE_BACKUP_CONFIG` | No Firebase writes, AI key, member account administration or media writes/deletes |
| Fictional qualification operator | Fictional-project member create/get/update; fictional Firestore fixture writes/reads; fictional media read; qualification backup secret | No production project access |
| Deployment | Hosting/Functions/Run deployment, Rules/index deployment and private release-state access; actAs only its two runtime identities | No owner/editor role, production backup key or unrelated project access |

Use custom roles where narrower than standard roles. Firestore IAM cannot restrict an Admin SDK identity to individual document paths; isolation to a two-member project and the tested orchestration code provide that boundary. The external model receives no Firebase credential or database tool. Its output can create a reply and a proposed suggestion only.

Enforce uniform bucket-level access and public access prevention, with no public principal. Hosted Storage Rules deny all SDK reads/writes; the authenticated gateway uses GCS directly and rejects download-token metadata. Verify these against actual Storage/IAM before using real content.

Create GitHub workload identity federation for `justinpfisher/justelle`, constrained to its immutable repository/owner IDs and the intended branch/environment. Production accepts only `main` and the `justelle-production` environment. Qualification accepts only the approved development branch or `main` in `justelle-qualification`. Grant workloadIdentityUser on the appropriate deploy/operator identity only. Use no long-lived service-account JSON key. After the first release, required checks and main protection must remain effective, while routine environment review must not add another go-live approval.

## Private configuration

The `justelle-qualification` and `justelle-production` GitHub environments each need these separate secrets:

- `JUSTELLE_WIF_PROVIDER`, `JUSTELLE_DEPLOY_SERVICE_ACCOUNT`, `JUSTELLE_DEPLOY_CONFIG`.
- Qualification also needs `JUSTELLE_QUALIFICATION_SERVICE_ACCOUNT` and `JUSTELLE_PROJECT_ID`.

`JUSTELLE_DEPLOY_CONFIG` is JSON with `mode`, `projectId`, `otherProjectId`, `site`, `origin`, `roomId`, `apiKey`, `gatewayServiceAccount`, `backupServiceAccount`, and `members` (two private email/password credentials for authenticated checks). Qualification additionally has `outsider` (fictional email/password) and `aiPricing`. Do not put actual values in this public repository, issues, screenshots or Actions output. The runner generates ignored `.env.<project>` and `.firebaserc` files at deployment time. Build public Firebase configuration contains no provider credential or personal record.

`JUSTELLE_BACKUP_CONFIG` is private JSON with `endpoint` (the B2 S3 HTTPS endpoint), `bucket`, `keyId`, `applicationKey`, `prefix`, and `recoveryKeyBase64`. The scheduled backup uses a separate identity and performs a local restore, encrypted upload, download checksum comparison and independent restore before reporting success. Monitor its sanitized `encrypted_backup_failed` event through private Cloud Logging alerting. Configure failure delivery to the owner, and test an actual scheduled run and failed run. Full scheduled snapshots are bounded to 128 MiB in this qualified first implementation; exceeding that limit fails visibly and requires capacity/retention changes. Independent offline recovery remains available through the provider-neutral CLI.

Set `JUSTELLE_HOSTED_CONFIGURED=true` only after identities, project alerts, secrets, IAM and site targets exist. The workflow then deploys qualification following source/browser/Windows checks and runs real protected HTTP/Firestore tests, live image-aware AI, competing agreements, revocation, B2 upload/download and offline restoration. It never runs against the production room. Qualification credentials and diagnostics are ephemeral and are not uploaded as artifacts.

Set `JUSTELLE_INITIAL_ACCEPTANCE=verified` only after hosted qualification, independent recovery, actual scheduled backup/failure checks, a real cloud rollback drill, and both actual iPhones have passed `iphone-acceptance.md`. This is a one-time evidence gate, not a renewed spending or publishing approval. Future authorised `main` changes automatically repeat checks, qualify separately, deploy, smoke-check both members and record the known-good source. The workflows exist in source but are not represented as configured or active until that evidence exists.

## Rollback and failure reporting

The production deploy runner stores only the verified source SHA in the private Firestore operations document. On a deployment or smoke failure, it rebuilds/redeploys the previous SHA, including Functions and Rules, and verifies that version. It never restores old private data or erases subsequent conversations. Hosting's pinned function revision keeps static code and the request gateway together. The scheduled function is also redeployed from the same prior source. Backward-compatible record formats are required for releases; destructive migrations need a separately prepared recovery plan.

A first-release failure has no prior version: the runner removes public invocation from the gateway and disables the new private Hosting site. A failed rollback is reported explicitly as requiring immediate operator attention. Source tests cover these orchestration paths; they do not qualify actual cloud rollback. Verify both success and failure in the fictional project before setting the initial acceptance flag. Actions provides sanitized summaries and failed-job notifications; confirm the owner's notification delivery independently. No private diagnostics or member content should appear in public artifacts.

## Local verification and launch limits — October 14

Source/adapter tests, official emulator Rules tests, isolated Functions-package loading/HTTP checks, the build, and preview lifecycle are available. The production runtime uses only `app.justelle.life`; qualification uses an isolated `web.app` project. The source bundle includes all local imports within the declared Functions `main`, with a locked Functions dependency manifest and a mandatory predeploy rebuild.

No hosted pass, actual B2 storage/restore, provider billing/IAM setup, live AI call, cloud rollback or physical iPhone result is established by those local checks. The hosted acceptance runner must be run after provider access. Preserve PR #5 outside production until launch requirements are satisfied; then merge/deploy under the existing authorisation without asking to go live again.
