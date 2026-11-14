import { legacySiteLanguageTarget, type PathLanguage } from '@nibleaf/shared/site-language';
import { siteBasePath } from '@/lib/site-paths';

export interface LanguagePathRedirectInput {
  /** The page route's splat (everything after the site base), encoded or decoded. */
  splat: string;
  /** The site's published languages (the shell's `languages`). */
  languages: ReadonlyArray<PathLanguage>;
  projectId: string;
  isCustomDomain: boolean;
  /** The current search string (with or without the leading `?`); other params survive. */
  search?: string;
  hash?: string;
}

/** Migrate legacy query-language URLs; canonical prefixed paths never redirect. */
export function resolveLanguagePathRedirect(input: LanguagePathRedirectInput): string | null {
  return legacySiteLanguageTarget({
    path: input.splat,
    languages: input.languages,
    basePath: siteBasePath(input.projectId, input.isCustomDomain),
    search: input.search,
    hash: input.hash,
  });
}
