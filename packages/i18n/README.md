# Translation builds

Run `pnpm install --frozen-lockfile`, then `pnpm --filter @nibleaf/i18n setup`.
The message-format and function-matcher plugins are exact build dependencies.
Their local paths use this repository's hoisted `node_modules` layout and resolve
relative to this package, as supported by the inlang directory loader.

Translation generation works offline after installation. This avoids a CDN
failure being reported only as a compiler warning followed by missing messages.
Build translations in the full build stage; the final production image receives
the generated Paraglide runtime from that stage. Translation JSON is unchanged.
