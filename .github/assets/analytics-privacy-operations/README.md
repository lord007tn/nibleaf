# Analytics, privacy, and operations evidence

Captured on 2026-11-08 with headless Playwright Chromium at 390 × 844, touch enabled, against production builds from this branch. The API, PostgreSQL, ClickHouse, cache, and storage used only the isolated `nibleaf-analytics` Compose project; app listeners were 4470–4472. All accounts, sites, and content are fictional fixtures. No owner browser, desktop, or shared browser session was used.

- `reader-consent-en-390.png` and `reader-consent-ar-390.png`: English and Arabic reader consent, policy link, equal-weight choices, and RTL layout.
- `reader-returning-declined-en-390.png`: returning declined visitor sees the reader and privacy choices without a pending prompt.
- `admin-old-customer-en-390.png` and `admin-old-customer-ar-390.png`: search finds the oldest synthetic customer among 505 records, in English and Arabic.
- `reader-admin-mobile.webm`: interaction recording of these journeys.
- `browser-results.json`: keyboard focus reaches the policy link, all measured consent controls are 44px high after entrance animations, no returning pending prompt, and no page errors.
- `drafting-connections-en-wide.png`, `drafting-connections-ar-390.png`, and `drafting-connections-empty-390.png`: the existing AI analytics view shows a connection breakdown and the selected-period empty state. Eight fictional stored events split 6/2 (75%/25%); no AI provider was invoked.
- `drafting-browser-results.json`: the real API's totals, connection shares, stored provider/model pairs, mobile page overflow check, and page errors.

Equivalent nonvisual evidence: PostgreSQL integration tests cover local-time totals, older unresolved operations across all queues, stable discovery pagination, and immutable reviewed input through the real publish worker. ClickHouse integration tests cover drafting connection attribution and legacy empty values. Unit/component tests cover storage failures, consent enforcement, hydration, lifecycle delivery, retention retry manifests, and stale reviews. Regression checks against the original main implementations failed for each of the six issues.

Limits: these browser journeys do not exercise a paid AI provider, browser unload receipt at the analytics backend, or production customer traffic. Export deletion retry tests inject object-store failures; they do not prove a production storage provider's availability. The 50,000-event PostgreSQL fixture is a bounded-response regression, not a capacity benchmark. The owner approved the minimal #346 breakdown in the existing view; its styling can follow the separate dashboard overhaul.
