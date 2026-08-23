const PUBLISHED_THEME_KEYS = ['theme', 'styling', 'typography', 'branding'] as const;

/** Most site chrome is intentionally live, but redirects are executable routing
 * configuration and must come only from the latest atomic READY snapshot.
 *
 * Versioned themes add a second atomic boundary. Once a project opts in by
 * storing a `theme` object, every theme-owned section is served from the READY
 * snapshot. This keeps saved draft customization in preview until the next
 * publish, while legacy projects without a theme object retain the historical
 * live-chrome behavior and therefore do not change appearance on migration. */
export function overlayLiveConfigPreservingPublishedRedirects(
  published: Record<string, unknown> | null,
  live: Record<string, unknown>,
): Record<string, unknown> | null {
  const merged = { ...live };
  // A live v1 theme intentionally activates the atomic boundary before its
  // first publish. Serving live here would leak the draft theme; overlaying the
  // last READY snapshot instead keeps the existing public appearance stable.
  const hasVersionedTheme = Boolean(published && 'theme' in published) || 'theme' in live;
  if (hasVersionedTheme) {
    for (const key of PUBLISHED_THEME_KEYS) {
      if (published && key in published) merged[key] = published[key];
      else delete merged[key];
    }
  }
  const publishedRedirects = published?.redirects;
  if (Array.isArray(publishedRedirects)) {
    merged.redirects = publishedRedirects;
  } else {
    delete merged.redirects;
  }
  return merged;
}
