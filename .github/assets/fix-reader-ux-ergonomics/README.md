# Reader UX ergonomics: evidence

Screenshots and walkthroughs for the published-reader changes in this branch.

- **Source:** a local Nibleaf stack (API, worker, app) with a seeded demo site:
  English and Arabic pages, two docs versions (`main`, `v1`), an announcement
  banner, code blocks, steps, tabs, callouts and accordions. All content is
  demo copy; no real accounts, keys or personal data appear.
- **Capture:** headless Chrome driven by Playwright at 1440×900 (desktop) and
  390×844 with touch emulation (phone). GIFs are assembled from captured frames,
  one frame per step or typed character.
- **Dark mode:** captures set the reader's own stored appearance choice (its
  theme toggle). Changing only the operating-system setting does not switch a
  site whose default appearance is light.
- **Before** images come from `main` at `6a71e996`. **After** images come from
  this branch.
- **Ask AI:** the demo instance has no AI provider, so the "Ask AI" row does not
  appear in these captures. Its behavior (built-in answers and the `onAskAi`
  handoff) is covered by `site-search.test.tsx`.
- **Not measured:** production-build Lighthouse/LCP/CLS numbers and numeric
  contrast ratios. Captures come from the development server.
