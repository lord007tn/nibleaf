/** Build the enforced HTML Content Security Policy for the dashboard,
 * marketing pages, and published sites. Scripts emitted by TanStack Start and
 * route head metadata receive the per-response nonce. Cloudflare injects its
 * analytics beacon after the origin response, so its script host remains an
 * explicit source rather than relying on a nonce it cannot receive. */
export function contentSecurityPolicy(nonce: string): string {
  return [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "frame-ancestors 'self'",
    "form-action 'self'",
    `script-src 'self' 'nonce-${nonce}' https://static.cloudflareinsights.com https://www.googletagmanager.com https://plausible.io`,
    "script-src-attr 'none'",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' data: https://fonts.gstatic.com",
    // Operators may intentionally use an HTTP S3-compatible endpoint on an
    // HTTP-only private deployment. Mixed-content rules still block it on HTTPS.
    "img-src 'self' data: blob: https: http:",
    "media-src 'self' data: blob: https: http:",
    "connect-src 'self' https: http:",
    "worker-src 'self' blob:",
    "manifest-src 'self'",
  ].join('; ');
}
