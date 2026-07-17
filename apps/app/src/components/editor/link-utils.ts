/**
 * Link URL validation/normalization for the editor's link popover.
 *
 * Only schemes that are safe and meaningful in published docs are allowed:
 * http(s), mailto:, tel:, in-page anchors (#…), site-relative paths (/…) and
 * document-relative paths (./…, ../…, or scheme-less like "getting-started").
 * Everything else — javascript:, data:, vbscript:, file:, unknown schemes —
 * is rejected. Bare domains ("example.com/docs") are upgraded to https://.
 */

/** Matches an explicit scheme prefix, e.g. `https:`, `javascript:`. */
const SCHEME_RE = /^[a-z][a-z0-9+.-]*:/i;

/** A bare domain (optionally with port/path/query/hash): `example.com`, `docs.foo.io/bar`. */
const BARE_DOMAIN_RE = /^[\w-]+(\.[\w-]+)+(:\d+)?([/?#].*)?$/;

/**
 * Normalize user input into a safe href, or return null when it is invalid.
 * Allowed: http(s) URLs, mailto:, tel:, `#anchor`, site-relative `/path`,
 * document-relative `./path`, `../path` and bare relative paths, and bare
 * domains (auto-prefixed with https://).
 */
export function normalizeLinkUrl(raw: string): string | null {
  const url = raw.trim();
  if (!url) {
    return null;
  }
  // In-page anchors and site-relative paths (but not protocol-relative `//…`).
  if (url.startsWith('#')) {
    return url;
  }
  if (url.startsWith('/')) {
    return url.startsWith('//') ? null : url;
  }
  // Document-relative paths — checked BEFORE the bare-domain upgrade so
  // '../foo.md' is never mistaken for a domain and https-prefixed.
  if (url.startsWith('./') || url.startsWith('../')) {
    return url;
  }
  // Bare domains next (checked before schemes: `docs.foo.io:8080/bar` would
  // otherwise read as a `docs.foo.io:` scheme). Upgraded to https.
  if (BARE_DOMAIN_RE.test(url)) {
    return `https://${url}`;
  }
  const scheme = url.match(SCHEME_RE)?.[0]?.toLowerCase();
  if (scheme) {
    if (scheme === 'http:' || scheme === 'https:') {
      return /^https?:\/\/[^/\s]+/i.test(url) ? url : null;
    }
    if (scheme === 'mailto:' || scheme === 'tel:') {
      return url.length > scheme.length ? url : null;
    }
    // javascript:, data:, file:, vbscript:, anything else → rejected.
    return null;
  }
  // Scheme-less bare relative path ("getting-started", "guides/intro") —
  // valid as long as it contains no whitespace.
  return /\s/.test(url) ? null : url;
}
