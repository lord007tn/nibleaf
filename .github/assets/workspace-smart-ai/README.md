# Workspace Smart AI verification

Captured on 3 November 2026 in the owner's personal Chrome profile, against an
isolated local PostgreSQL database, Redis namespace, object bucket and Qdrant
collection. The application, authentication, settings API, encrypted persistence,
publish worker, index worker and search/answer routes are real. All documents,
accounts and API keys are fictional. OpenAI and OpenRouter upstream responses
are controlled transport fixtures: these checks do **not** prove live provider
credit, permissions, model quality, OAuth approval or production acceptance.

## Browser evidence

- `setup-unconnected.png`: initial unconnected state; saving and enabling are separate.
- `setup-en-desktop.png`: selected OpenAI connection, blank saved-key field and READY index.
- `setup-ar-desktop.png`: Arabic/RTL settings after disabling, with the connection retained.
- `setup-invalid-key.png`: rejected verification gives a safe error without reflecting the key.
- `setup-en-mobile390.png` / `setup-ar-mobile390.png`: settings at 390 × 869.
- `reader-answer-en.png` / `reader-answer-ar.png`: published-page citations through the actual reader/API/index flow.
- `reader-answer-ar-mobile390.png`: Arabic answer and source card at 390 × 869.
- `setup-walkthrough.gif`: discrete screenshots captured during setup, verification,
  enablement, indexing and reader answers. This is an animated walkthrough, not a
  continuous video. The available native Chrome control exposed screenshots but
  no continuous recorder. The screenshots and persistence/API checks provide
  equivalent interaction evidence. Browser chrome and DevTools were cropped out.

The new Smart AI screen has no equivalent screen on the base revision. The initial
unconnected screenshot shows the starting configuration, not a fabricated old UI.
English and Arabic were exercised. Other Smart AI interface languages currently
use English fallback copy; provider integration descriptions are localized.

## Persistence and failure checks

Real isolated database checks passed for owner authorization; rejection of
editors, outsiders and API-key principals before provider access; encrypted
storage; secret-free DTOs/audit events; save without enablement; explicit provider
selection; replacement confirmation; stale revisions; failed verification
preserving the previous credential; exactly one concurrent replacement; copied
cross-workspace ciphertext rejection; and disable preserving credentials.

OpenRouter additionally exercised authentication metadata and model catalogs.
Embedding vectors contain 1536 values. Scoped credential resolution and strict
structured answers used the official SDK. A fixture-only failure caused by
missing required OpenRouter `system_fingerprint` response metadata was corrected
before the final passing run; product validation was retained.

After disabling, a fresh public API read reported answer capability false,
ordinary keyword search still returned results, and submitting the previously
answered question returned HTTP 503 instead of its cached answer.

Focused regression checks cover credential ownership, provider endpoints and
request shapes, cache invalidation on disable/revision change, and credential
lookup failure before acquiring an indexing claim. No CI workflow or Docker
trigger was added. Hosted OpenAI OAuth remains unavailable pending registration.
