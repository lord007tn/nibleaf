# Evidence: dashboard-ux-editor

Captured on 2026-11-06 from a local development stack (dashboard, API and publish worker on shared local
PostgreSQL / Dragonfly / ClickHouse / S3 / Mailpit containers) with headless Chromium driven by the repository's
`playwright-core`.

- **Before** images come from unmodified `main` at `6a71e996`: either a new-user browser walk taken before any
  change, or the same screen served from a separate checkout of `main` against the same API and data.
- **After** images and walkthroughs come from this branch.
- Viewports: desktop 1280×800 and phone 390×844 (touch). Languages: English and Arabic (right-to-left).
- All accounts are synthetic `@example.com` addresses; sign-up codes were read from the local Mailpit inbox.
  Sites, articles and DNS values are sample data. No secrets or personal data appear.
- GIFs are 8 fps (6 fps for the delete walkthrough) exports of the recorded WebM; the MP4 files are the same
  recordings at full frame rate.
