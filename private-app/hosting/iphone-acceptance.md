# Initial iPhone acceptance — two devices

Run only after the fictional site is deployed and the server-side qualification passes. Use two actual iPhones on currently supported iOS releases, two fictional member accounts, synthetic data, and no personal photos or real-life records. Record pass/fail and app version only; do not put names, email addresses, tokens, screenshots with private content, or device identifiers in GitHub.

Establish once before initial real use; repeat only the affected checks for authentication, Home Screen, media/offline changes or observed regressions. Ordinary text/style changes do not need another owner device session.

For each device:

1. Open the qualification URL in Safari and sign in as a different fictional member. Confirm outsider account and signed-out access are denied.
2. Add the app to the Home Screen from Safari, launch that copy, then force-close and reopen it. Confirm session persistence; sign out and confirm reopening shows the sign-in screen.
3. Create a synthetic adventure and confirm the other member sees it. Make an edit from each device; confirm authorship and time in History.
4. Move an intended stay immediately without second-member approval. Confirm Undo preserves history, a stale edit cannot overwrite the other member, and confirmed booking dates/originals do not silently move with the plan.
5. Exchange JPEG and PNG images; on a device that can supply HEIC, upload a real HEIC sample. Confirm previews, full-size viewing, and correct orientation. Retry a saved upload after interrupting network; confirm no duplicate or overwrite.
6. Turn on Airplane Mode. Confirm saved history remains understandable, unsent work gives a clear error, and restoring connectivity recovers without duplicate messages or lost originals.
7. From the member session, open the protected image route and confirm it loads. Sign out, then try that same route plus the direct Firebase Storage and raw GCS object URLs; each must deny access. Reopen while signed in and verify it still works.
8. As the qualification operator, remove one member from the fictional room and revoke that account's refresh tokens. On the removed device, refresh/reopen and confirm Firestore access and protected media are denied. Restore only disposable fictional qualification state after recording the result.

Both devices must pass Safari and Home Screen checks. Stop qualification for any public image URL, missing original/planner history, incorrect author, persistent access after membership removal, duplicate retry, or unrecoverable offline state. Save only the checklist results and sanitized HTTP status codes.
