# Landing, consent and first manual publish verification

Verified September 5, 2026. These are synthetic local checks of a production build, not customer activation, deployed release, or processed Google Analytics evidence.

## Problem and change

- At 360px, the live English header extended to 384px and clipped the account action. The count now stays off small screens and intermediate navigation no longer crowds the header.
- The live Arabic hero had a negative left edge despite the document reporting no horizontal overflow. Its grid now permits shrinking; the 360px heading fits between x=24 and x=336. Code content scrolls inside its card.
- GitHub stars came from a different repository than the visible link. The existing loader now requests `lord007tn/nibleaf`; cold/error zero values are not presented as authoritative counts. The loader/cache contract is preserved. Unmeasured publishing-time promises were removed.
- The grader signup bridge supplies the existing `intent=first-publish`, retaining its campaign parameters. With analytics consent it also persists the finite source `rtl_readiness_grader`, entry `free_tool` and placement `result_bridge` through the existing attribution contract. It uses the existing sample-project path.
- Consented events that precede public metadata initialization wait in a bounded in-memory queue. Private-route teardown disables delivery, withdrawal clears pending/source context, and cross-tab consent changes are observed. GTM's persistent data model is cleared for omitted event dimensions.
- Google OTP sign-in does not establish that a new account was created. The ambiguous browser `sign_up` was removed; server `signup_completed` remains canonical.
- Metadata-only saves and unchanged autosaves no longer count as first content edits. The process-local deduplication set was removed; deterministic database IDs handle concurrent new receipts while a historical lookup preserves older receipts. Edit logging remains best-effort.
- A READY retry preserves its immutable snapshot and retries completion delivery. Canonical deployment receipts and the first manual publish marker use deterministic IDs. Anonymous source attribution commits atomically with the first marker, excludes automatic jobs and previously activated author/project pairs, and carries no user/project identifier. A delivery error after READY no longer downgrades the snapshot to FAILED. Job/project identity is checked before mutation.

## Visual evidence

| Surface | Evidence |
| --- | --- |
| English landing, 360px | [Mobile](landing-en-mobile.png) |
| English landing before fix, live 360px | [Before](before-en-mobile.png) |
| English landing, 1440px | [Desktop](landing-en-desktop.png) |
| Arabic landing, 360px | [Mobile](landing-ar-mobile.png) |
| Arabic landing, 1440px | [Desktop](landing-ar-desktop.png) |
| Grader result | [Mobile](grader-en-mobile.png) |
| Signup entry | [Mobile](signup-en-mobile.png) |
| Grader to signup interaction | [Recording](grader-signup.webm) |

The recording shows a synthetic grader result and navigation to the signup form. API responses are intercepted; it does not demonstrate an OTP, authenticated editor session, or a real publish. The result score describes the supplied fixture only.

## Google integration evidence and limits

[Sanitized intercepted receipts](intercepted-google-routing.json) retain event names, destination, public location, phase and marker-presence booleans. They omit client/session identifiers and cookie values. All collector requests and first-party writes were intercepted; the public Google scripts executed unchanged. Transport attempts, including repeated buffered attempts, must not be counted as processed events.

[Final same-page consent review](same-page-consent-review.json) adds before/after evidence for a synthetic private referrer path and grant → decline → regrant without navigation or reload. Before the correction, the path reached Google and regrant left the explicit page-view count at one. Afterward, page views and native engagement carry only the referrer origin; no synthetic path/query marker appears. The explicit count advances from one to two on regrant. Opening and closing preferences preserves the count and keeps the destination enabled; actual decline disables it. The same document and single GTM loader are retained throughout. Component tests also verify ordinary rerender deduplication. The panel's appearance is unchanged.

- Pending and declined: no Google script and no collector attempt in the fresh context; the grader still works.
- Accepted: one app-owned GTM loader for `GTM-K4FKZFK8`, followed by its Google-owned destination script for `G-S1HY418MM8`. No independent app GA loader/config was installed.
- Default denied precedes granted; advertising/user-data consent stays denied. Google page views, tool stages and native engagement use query-free page locations. Referrers are origin-only, including same-origin referrers. Synthetic markers in the URL, referrer path, HTML and signup inputs were absent from the final inspected collector and first-party bodies.
- Signup preserves first-publish intent. Reload preserves the GA client cookie (boolean comparison only). SPA navigation to sign-in keeps the same document and suspends marketing delivery. This does not establish cross-subdomain or OAuth session continuity.
- Withdrawal, pagehide, navigation and reload produced no post-withdrawal collector attempt in this bounded final pass and left no GA cookie. Regrant loaded the destination again. Earlier actual-runtime checks showed buffered events and cookie recreation under Consent Mode alone. The patch adds Google's destination opt-out before denied consent and clears cookies. **This is not a guarantee against all native prebuffered flushes.** No global fetch/beacon interception is added to application code.
- Public Google destination script inspection confirms optional history, scroll, outbound, forms, video and download detection disabled, and automatic user-provided data collection disabled. The base page-view capability remains enabled; GTM `send_page_view=false` and the approved event tag own explicit page views. Public configuration is evidence about the published script, not proof of processed data or every account setting.
- Existing event mappings remain unchanged. Source/grader dimensions are not automatically forwarded. Anonymous first-party source-stage counts do not establish an individually joined conversion funnel.

The release runtime must expose both existing public identifiers: `MARKETING_GTM_ID=GTM-K4FKZFK8` and `MARKETING_GA4_ID=G-S1HY418MM8`. The GA ID enables opt-out while GTM retains loader precedence. The metadata handler previously masked it whenever GTM was configured. Current deployed environment presence is unverified here; the browser fixture explicitly supplies this pair. Valid Google-owned destination script IDs provide compatibility with older metadata.

Google references: [global page context](https://developers.google.com/analytics/devguides/collection/ga4/reference/config), [tag API and parameter scopes](https://developers.google.com/tag-platform/gtagjs/reference), [collection opt-out implementation](https://firebase.google.com/docs/reference/js/analytics#setanalyticscollectionenabled).

## Validation and release gate

Local full typecheck, lint, tests and production build passed. Documentation, dead-code, self-host and release contract checks passed. The existing public preload budget passed: baseline `071bb52` reported 379.01 KiB gzip, final review build 379.66 KiB, limit 380.86 KiB. No budget, chunk policy, translation architecture or Docker workflow was changed. This is preload-budget evidence, not field performance.

### Grader attribution and notification retry review

[Sanitized grader browser check](grader-attribution-review.json) verifies the actual result CTA at 360px: accepted consent preserves the grader source through signup and reload; declined consent preserves navigation but creates no attribution. Withdrawal clears the stored source. The submitted HTML marker is absent from every captured write. This attribution-only pass intercepts Google scripts and all writes; the earlier Google-runtime proof above is separate. The UI is unchanged, so the existing screenshots and recording remain applicable. Actual grader component tests additionally exercise project/editor stage requests; strict server schemas reject mismatched source/entry/placement and extra HTML fields. The deployment action passes this source to the manual worker job, and the worker records it only at trusted READY. The grader source begins at its CTA; no new grader landing count or individually joined conversion denominator is claimed.

Regression tests against the preceding implementation reproduced null grader attribution and 24 inbox rows for eight concurrent retries across three members. Deployment notifications now use deterministic IDs per deployment, project, outcome and recipient. Inbox inserts skip existing IDs; email enqueue uses stable BullMQ job IDs. Both channels are attempted independently, partial enqueue/insert failures propagate for retry, preferences remain respected, and notification delivery does not depend on activation receipt insertion. Focused tests cover concurrent retries, different outcomes/deployments/recipients, partial recovery, duplicate email addresses and READY preservation after a delivery error.

The opt-in PostgreSQL suite includes real concurrent inbox inserts, with membership lookups and email enqueue mocked. CI must execute both PostgreSQL tests; local runs skip them without the disposable service. This proves database uniqueness, not Redis execution or provider delivery. Inbox deduplication lasts while its deterministic rows remain; older randomly identified rows are not retroactively deduplicated. Email deduplication lasts only while the job remains retained: existing completion retention is count 100 / age one day, so count eviction can shorten it. Failed jobs have their existing retries and retention; an exhausted retained failed job needs operational retry. Deletion/eviction or provider acceptance before acknowledgement can still permit duplicate delivery. No permanent exactly-once delivery, retention change, migration or real email send is claimed.

Focused tests cover delayed metadata, consent withdrawal/private routes, opt-out ordering, sanitized context, meaningful edits, historical receipt preservation, strict manual attribution, retry/idempotency and project scoping. The PostgreSQL test is explicitly opt-in and runs against CI's disposable migrated PostgreSQL service; it is skipped without that service locally. Use the PR's actual CI result as execution evidence, not merely this test's presence.

Before release approval: verify green exact-head CI including PostgreSQL concurrency, deploy identity and migrations, public API metadata, rendered EN/AR mobile/desktop, authenticated signup/editor/manual publish with scoped fixtures, and processed analytics ownership/session behavior. There was no merge, deployment or production database write from this task. Docker builds remain manual.

Rollback the application change by reverting this PR and deploying the previous approved image through the normal release process. No schema migration is needed. Existing event readers tolerate the additional marker type; retain receipt history. Reverting code does not reverse provider settings. Provider rollback is separate: restore only the named optional detection/user-data settings from its recorded before-state if explicitly required; do not silently restore them during an application rollback.
