/** Most site chrome is intentionally live, but redirects are executable routing
 * configuration and must come only from the latest atomic READY snapshot. */
export function overlayLiveConfigPreservingPublishedRedirects(
  published: Record<string, unknown> | null,
  live: Record<string, unknown>,
): Record<string, unknown> | null {
  const merged = { ...live };
  const publishedRedirects = published?.redirects;
  if (Array.isArray(publishedRedirects)) {
    merged.redirects = publishedRedirects;
  } else {
    delete merged.redirects;
  }
  return merged;
}
