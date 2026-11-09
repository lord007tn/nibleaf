# Maxio upload proxy evidence

Captured 2026-11-09 in the owned `nibleaf-upload` stack with maxio 0.4.2 behind Traefik v3.6, plus the local app/API on 4530/4531. Fictional QA workspace only.

- Direct signed browser PUT through Traefik: 403 SignatureDoesNotMatch.
- API upload: 204; reuse: 400; confirm: 201; internal HEAD: expected bytes.
- Full 50 MiB upload through the actual app proxy: 204; HEAD: 52428800 bytes.
- Headless Playwright: editor Image picker -> upload -> confirm -> inserted image decoded (1440 px wide).

`editor-upload.png` and `editor-upload.webm` show the successful editor journey. `browser-result.json` records the browser assertions. These are local regression results, not production deployment acceptance.
