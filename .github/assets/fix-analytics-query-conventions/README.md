# Site overview page views: before and after

Captured on 2026-11-06 from a local stack (app and API) with the repository's demo seed. All data is fictional.

The project analytics request was intercepted in the browser for each state:

- `*-unavailable-*`: the API answers with `availability: "unavailable"` and `totalViews: null`, which happens when ClickHouse is down.
- `*-failed-*`: the request fails at the network level. The shared retry policy retries twice before giving up.

| File | Shows |
|---|---|
| `site-overview-before-*.png` | `main` (e1244b8f): the Page views tile shows **0**, the chart says "No traffic yet", and a failed request goes unreported |
| `site-overview-after-*.png` | This branch: the tile shows **—** (unknown) and the chart says the figures are unknown. A failed load is reported once, in plain language, through the shared query cache (English and Arabic) |

Each state is captured in English at desktop width and in Arabic at 390 px.
