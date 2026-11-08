# Node 26 runtime qualification

Nibleaf qualifies Node 26.13.0 on Alpine 3.24 for its container services under
issue #51's explicit qualification option. This is a Nibleaf compatibility
decision, not a claim of upstream Ghost support.

The installed `@tryghost/kg-lexical-html-renderer@1.5.0` declares
`^22.22.2 || ^24.15.0`; `@tryghost/kg-mobiledoc-html-renderer@7.2.3` declares
`^22.13.1 || ^24.0.0`. Both exclude Node 26. The latest published Lexical
renderer checked on 2026-11-08, 1.5.3, still excludes Node 26; Mobiledoc's
latest remains 7.2.3. No engine declarations are patched or suppressed.

The reachable importer uses the official renderers through CommonJS
`createRequire`, then converts their HTML with Turndown. Qualification exercises
both formats with actual renderer instances, including Arabic headings,
formatting and links, and requires `usedFallback: false`. Plain-text fallback
must not make a failed renderer look compatible. Existing asset-migration and
PostgreSQL import-safety suites cover the surrounding importer flow.

Keep the runtime, digest-pinned Docker base, contributor `.nvmrc`, service build
targets, CI and direct Node typings aligned. The separately distributed CLI
retains its Node 22 output target and consumer engine range; contributor builds
use the repository's Node 26 runtime. Transitive typings remain dependency-owned.

Release acceptance requires all workspace builds, typecheck, lint, dead-code
checks, the full test suite, enabled PostgreSQL/ClickHouse integrations, bundle
boundaries and a manually built exact-image smoke of server, worker, app, admin
and both migration modes. Docker builds remain manual-only. Isolated acceptance
does not claim publication or production deployment.

Revisit the qualification when either renderer family changes or publishes an
engine range admitting Node 26. Re-run the importer suites and exact Alpine
image checks for that dependency change; do not infer compatibility from an
engine range alone.
