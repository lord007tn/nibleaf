# @nibleaf/cli

Official command-line access to Nibleaf's public, agent-readable surface. The CLI does not accept or store credentials.

## Use it when

- an agent needs to discover a Nibleaf site's `llms.txt`, sitemap, or OpenAPI contract;
- a release check needs to prove a real 404 and cache-safe Markdown negotiation;
- a script needs the Markdown representation of a canonical public page.

## Commands

```bash
npx @nibleaf/cli inspect https://nibleaf.com
npx @nibleaf/cli inspect https://nibleaf.com --json
npx @nibleaf/cli fetch https://nibleaf.com/developers
```

`inspect` checks the site root, `llms.txt`, `sitemap.xml`, `openapi.json`, `Accept: text/markdown`, `Vary: Accept`, and a deterministic nonexistent path. It exits non-zero when an essential check fails.

`fetch` requests `text/markdown` from the supplied canonical URL and writes the response body to stdout.

The supported API boundary is documented at [nibleaf.com/developers](https://nibleaf.com/developers). Dashboard browser-session routes are not a supported third-party write API.
