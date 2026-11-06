# Evidence: loading states and TanStack Query foundation

Captured on 2026-11-06 from a local development stack (dashboard + API on shared local services) with headless
Chromium driven by the repository's `playwright-core`, desktop 1280×800, English.

- **Simulated slow network:** every `/api/` response was delayed by 1.5 s in the browser, so loading states stay on
  screen long enough to see. Before = unmodified `main` (`6a71e996`); after = this branch.
- Account and data are synthetic (`@example.com`). GIFs are 8 fps exports of the recorded WebM.
