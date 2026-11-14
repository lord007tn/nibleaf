# Translation builds

Run `pnpm install --frozen-lockfile`, then `pnpm --filter @nibleaf/i18n setup`.
The message-format and function-matcher plugins are exact build dependencies.
Their local paths use this repository's hoisted `node_modules` layout and resolve
relative to this package, as supported by the inlang directory loader.

Translation generation works offline after installation. This avoids a CDN
failure being reported only as a compiler warning followed by missing messages.
Build translations in the full build stage; the final production image receives
the generated Paraglide runtime from that stage. Translation JSON is unchanged.

# Translating the catalogs

- **Glossary.** `glossary/terms.json` has the source terms (site, organization,
  publish, draft, member, Ask AI, the analytics terms…) with what each means,
  plus `doNotTranslate`: product and technical names that stay as written in
  every locale (Nibleaf, Mintlify, GitHub, Markdown, MCP, API, URL…). Each
  locale keeps `glossary/<locale>.json` with its word for every term, and every
  string in that catalog uses those words. The UI says "organization", never
  "workspace"; English strings that still say workspace mean an organization.
- **Untranslated guard.** `src/untranslated.test.ts` fails when a locale has a
  value identical to English, unless nothing translatable is left once
  `{placeholders}`, `doNotTranslate` terms, numbers and punctuation are taken
  out, or the key is listed in `untranslated/<locale>.json`: `sameAsEnglish`
  (identical on purpose, such as a loanword the locale uses as is) or `pending`
  (not translated yet). `pending` only shrinks: a listed key that is now
  translated fails too. The same test checks that every locale keeps every key
  and never loses or invents a placeholder.
- **Counts.** `pnpm --filter @nibleaf/i18n run untranslated [locale]` prints
  each locale's untranslated count (and, for one locale, the keys not listed).
  After translating, `pnpm --filter @nibleaf/i18n run untranslated -- --baseline <locale>`
  rewrites that locale's `pending` list from the catalog; it refuses to grow it.
