# Evidence: loading states and query conventions across the dashboard

Captured on 2026-11-06 from a local development stack (dashboard, API and publish worker on shared local services) with
headless Chromium driven by the repository's `playwright-core`.

- **Simulated slow network:** after the site has loaded normally, every `/api/` response is delayed by 1.5 s, so the
  loading states for in-app navigation and actions stay on screen long enough to see.
- **Before** is unmodified `main` (the merged dashboard UX stack and #286). **After** is this branch.
- Viewports: desktop 1280×800 (English) and phone 390×844 (Arabic). Accounts and data are synthetic (`@example.com`).
- GIFs are 8 fps exports of the recorded WebM.
