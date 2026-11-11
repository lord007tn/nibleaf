import { languagePathTarget, type SiteLanguageCandidate } from '@nibleaf/shared/site-route';
import { siteBasePath } from '@/lib/site-paths';

// Language-prefix resolution is shared with the pre-publish link checks.
export { matchSiteLanguage } from '@nibleaf/shared/site-route';

export interface LanguagePathRedirectInput {
  /** The page route's splat (everything after the site base), encoded or decoded. */
  splat: string;
  /** The site's published languages (the shell's `languages`). */
  languages: ReadonlyArray<SiteLanguageCandidate>;
  projectId: string;
  isCustomDomain: boolean;
  /** The current search string (with or without the leading `?`); other params survive. */
  search?: string;
}

/**
 * The published site selects its language via `?lang=<code>`, but visitors (and
 * links from Mintlify-style sites) commonly guess `/ar` or `/ar/guides`. When
 * the first path segment is one of the site's language codes, return the
 * equivalent `?lang=` URL — or null when the path isn't a language prefix.
 */
export function resolveLanguagePathRedirect(input: LanguagePathRedirectInput): string | null {
  return languagePathTarget({
    splat: input.splat,
    languages: input.languages,
    basePath: siteBasePath(input.projectId, input.isCustomDomain),
    search: input.search,
  });
}
