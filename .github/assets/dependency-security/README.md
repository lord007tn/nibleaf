# Dependency and reader verification

All screenshots and the recording use synthetic local demo data. No client content,
credentials, saved browser sessions, or private production logs are included.

- `math-before.png`: compiled main d089331; missing MathML/layout styles and broken formula positioning.
- `math-after-desktop.png`, `math-after-mobile.png`: compiled candidate; two formulas with accessible MathML, preserved layout styles, and hidden duplicate visual output. Mermaid still renders two nodes. Both viewports have no horizontal overflow or page errors.
- `account-mobile-ar.png`: representative shared stylesheet parity at 390 × 844, Arabic RTL.
- `publish-mobile.png`, `publish-mobile.webm`: updated app/API/worker; blocked browser storage, edit, immediate publish, worker READY and exact reader receipt.
- `verification.json`: audit classifications, baseline refs and hashes, local test/build commands and counts, source hashes, compatibility limits and primary sources.

The production dependency audit has zero findings. The full source-lock audit still
has one unfixed high advisory in root development tooling (`ultracite → fast-glob →
micromatch → braces`). Docker currently copies that tooling into the image: #195
tracks runtime packaging and explicit manual image proof. No suppression was added;
the three obsolete Ghost advisory exceptions were removed.

The image-size patch preserves both module entrypoints and keeps file sizing opt-in.
Its optional local-file path now has a 16 MiB regular-file allocation/read limit.
Nibleaf's Ghost importer does not enable that option. Both default Ghost output
parity and optional sizing compatibility are covered by the added tests.

`http-cache-semantics` 4.3.0 falls outside the advisory's affected version range.
The upstream max-stale/cache advisory is disputed; the version update is not
claimed to change that cache policy. Nibleaf's Got callers keep shared caching
disabled, confirmed by a loopback two-caller test.

Node 24 local tests, Node 22 CI, published images, running production revisions,
backup restoration and authenticated client acceptance are separate evidence.
