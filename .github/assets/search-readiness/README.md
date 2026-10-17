# Search readiness evidence

Captured on 2026-10-17 in the isolated local `nibleaf-search-qa` namespace, using real PostgreSQL, Dragonfly, S3-compatible storage, Qdrant and OpenRouter. The illustrated booking/API examples are fictional acceptance fixtures.

- `authoring-persisted-en.png`: Markdown saved and read back through the editor.
- `grounded-answer-en.png`: a provider-backed answer with an authorized source link.
- `reader-mobile-ar.png`: Arabic reader at 390 × 844.
- `grounded-answer-mobile-ar.png`: Arabic answer with a preserved code identifier and citation at 390 × 844.
- `reader-journey.gif`: stepped captures of query entry, generation, cited answer and source navigation. This is an interaction walkthrough, not a continuous video. Connected Chrome's screencast yielded no frames for the successful run, so the captures accompany UI assertions and API/index readback.

These images establish local browser behavior. They do not establish deployment or production acceptance.
