# Isolated hosted qualification and gateway

The public homepage stays on its existing hosting. The private application builds into `private-app/dist` only. This configuration uses the separate `justelle-private-qualification` Hosting target. Production uses `firebase.production.json` and the separate `justelle-private-production` target. Each target must map to a Hosting site in its own Firebase project; do not map either target to the existing homepage site.

## Gateway implementation

`functions/index.mjs` registers the tested `media-handler.mjs` core as a second-generation HTTPS function named `privateApi` in `northamerica-northeast1`. Hosting forwards `/api/**` to that function. The handler verifies Firebase ID tokens with revocation checks, reads current room membership from Firestore for every image request, and uses the default private Storage bucket through the Admin SDK. GCS writes are immutable and do not create Firebase download tokens. Storage Rules deny all direct client access. The function has zero minimum and three maximum instances, 512 MiB memory and a 30-second timeout.

The function requires `JUSTELLE_ROOM_ID` and `JUSTELLE_GATEWAY_SERVICE_ACCOUNT` in the non-repository `functions/.env.<project-id>` file at deployment. The service account must be provisioned separately in each project. Give it only the ability to read room membership and create/read objects in that project's private bucket; it must not have public access or object deletion. The Cloud Functions deployment identity must have only the project-scoped permissions needed to deploy the function, Hosting site and rules. Keep WIF provider, deployment identity, project IDs, site IDs, API configuration and room IDs in the matching GitHub Environment or cloud account, never in this public repository.

The `/healthz` response has no data and confirms only that the function can answer. It does not prove authentication, membership, bucket IAM, media or production readiness. The underlying function endpoint is also protected by Firebase ID token and membership checks; Hosting is the intended browser entry point. There is no CORS allow list because the application uses same-origin Hosting rewrites and the endpoint emits no CORS grants.

## Separate client builds

A fictional hosted trial needs explicit build variables: `VITE_JUSTELLE_MODE=hosted-fictional`, `VITE_JUSTELLE_ORIGIN`, `VITE_FIREBASE_PROJECT_ID`, `VITE_FIREBASE_API_KEY`, `VITE_FIREBASE_AUTH_DOMAIN`, `VITE_FIREBASE_STORAGE_BUCKET`, and `VITE_JUSTELLE_ROOM=fictional-room`. These are browser configuration, not server credentials. The project ID, origin and bucket must match the qualification project.

The production client currently has no real-member runtime mode. Do not build the production app using the fictional mode or place real identities/content in qualification. Add and test the production runtime configuration only after the production Firebase project, sign-in and membership provisioning are ready. The app currently signs in with email/password; enable that provider only in the isolated projects and create accounts outside this repository.

## Deployment and qualification status

This is deployable source/configuration, not a verified live deployment. There is no Firebase project binding, Hosting site mapping, Billing setup, IAM grant, custom domain, deployed function, or automated production deploy credential yet. Do not deploy until those items exist. Keep the root website workflow and its `CNAME` untouched.

After deploying the fictional target, run:

```sh
npm run qualify:hosted -- /outside-repository/trial.qualification.json
```

The external qualification file supplies the fictional origin/project/room/bucket, one existing fictional record and image ID, and fictional member/outsider/revoked-member ID tokens. The script verifies member access and denial for unauthenticated, outsider, and revoked access; direct Firebase Storage denial; raw GCS denial; and no-store media responses. It does not create accounts, change membership, activate billing, or write data. Prepare revoked membership before the run. It prints statuses only, never tokens.

Also verify immutable upload/retry, absence and denial of Firebase download-token URLs, and that actual members can never read the private bucket directly. Qualify agreements and recovery against hosted fictional Firestore data. Exercise sign-in/revocation and real JPEG/PNG/HEIC behavior offline and on both actual iPhones using Safari and installed Home Screen mode. Emulator and HTTP tests cannot establish those results.

## Still required before production

- Create separate qualification and production Firebase projects and map separate Hosting sites.
- Configure authentication, member custom claims and exact room membership independently in each environment.
- Provision and verify least-privilege service accounts, private bucket IAM, Billing, project spend alerts and resource limits.
- Deploy fictional qualification, then run the complete hosted security, data-integrity and recovery sequence.
- Finish encrypted scheduled backups to a separate provider; restore from that provider with Firebase unavailable and verify originals, corrections, agreements and authorship.
- Add production real-member mode and its server-side configuration; verify login, revoked sessions and the restricted gateway in production.
- Complete actual-iPhone acceptance on the two devices.
- Configure main-branch deployment, health/auth smoke checks, failure reporting and tested rollback only after target and WIF credentials exist.

No paid service, DNS, account, credential, personal content or real identity was activated by this change.
