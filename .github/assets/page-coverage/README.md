# Page coverage visual verification

Sanitized renders of the local production app, reviewed September 11, 2026.
These screenshots contain only public marketing content. They do not show an
authenticated workspace, customer data, or production deployment evidence.

- Four new English/Arabic articles, both guide hubs, pricing, the GitBook
  comparison, and ReadMe alternatives at 320px, 390px, and 1440px.
- `integrations-table-320.png` shows the focusable table region. The accompanying
  `table-keyboard-scroll.webm` demonstrates keyboard scrolling in both directions.
- `pricing-features-320.png` shows the release caveat and mobile feature grid.

Browser checks covered all six existing comparison/alternative routes plus the
four new articles, both hubs, and pricing: 39 route/viewport combinations returned
200, one H1, the expected canonical, no noindex meta, and no page-level overflow.
New Arabic articles declare RTL and reciprocal English/Arabic/x-default links.
The full 60-URL sitemap passed HTML/Markdown parity. Fresh article visits loaded
no Google Analytics, Tag Manager, or Plausible runtime.

The local preview runs without the API/database; public-meta requests therefore
return 502 and local sign-up cannot initialize. CTA navigation reaches `/sign-up`;
the separate public sign-up page was checked after hydration and displayed name,
email, Google, and terms controls. No account was created and no publish or
provider delivery is claimed. Browser state and raw logs are not included here.
