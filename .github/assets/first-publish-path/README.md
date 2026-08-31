# First-publish path review evidence

Captured on 2026-08-31 from the production build served locally at 1440px
desktop and 390px mobile widths. These images cover the two existing acquisition
articles, their shared manual-publish bridge, and the embedded English editor
and Arabic/RTL product evidence.

- `intro-desktop-top.png`: Mintlify-alternative article desktop introduction.
- `intro-activation-bridge.png`: desktop first-publish activation bridge.
- `intro-arabic-rtl-evidence.png`: Arabic/RTL product evidence in the article.
- `self-host-mobile-top.png`: Docker Compose guide at 390px.
- `self-host-mobile-activation-bridge.png`: mobile activation bridge.
- `self-host-mobile-editor-evidence.png`: English editor evidence at 390px.

The local visual run did not start the production API, so the public metadata
request returned 502. Repository tests cover the strict analytics contracts and
the exact-deployment READY milestone; live API, authentication, publication,
and aggregate-receipt evidence remain post-deployment gates.
