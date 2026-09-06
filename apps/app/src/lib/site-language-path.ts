import { siteBasePath } from '@/lib/site-paths';

export interface SiteLanguageCandidate {
  code: string;
  isDefault: boolean;
}

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

const safeDecode = (value: string): string => {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
};

const baseCode = (code: string): string => code.split('-')[0] ?? code;

/**
 * Match one URL path segment against the site's language codes: an exact
 * (case-insensitive) match wins, then the language whose base code equals the
 * segment (`ar` → `ar-SA`). Returns the site's own code so `?lang=` carries the
 * exact value the API resolves.
 */
export function matchSiteLanguage<T extends SiteLanguageCandidate>(segment: string, languages: ReadonlyArray<T>): T | undefined {
  const wanted = safeDecode(segment).trim().toLowerCase();
  if (!wanted) {
    return undefined;
  }
  return (
    languages.find((language) => language.code.toLowerCase() === wanted) ??
    languages.find((language) => baseCode(language.code).toLowerCase() === wanted)
  );
}

/**
 * The published site selects its language via `?lang=<code>`, but visitors (and
 * links from Mintlify-style sites) commonly guess `/ar` or `/ar/guides`. When
 * the first path segment is one of the site's language codes, return the
 * equivalent `?lang=` URL — or null when the path isn't a language prefix.
 *
 * The default language's clean URL is canonical (no `?lang`), so `/en/...`
 * drops the param instead of pinning it. Other search params are preserved; an
 * existing `?lang=` is overridden by the language named in the path.
 */
export function resolveLanguagePathRedirect(input: LanguagePathRedirectInput): string | null {
  const [first, ...rest] = input.splat.split('/').filter(Boolean);
  if (!first) {
    return null;
  }
  const language = matchSiteLanguage(first, input.languages);
  if (!language) {
    return null;
  }
  const params = new URLSearchParams(input.search ?? '');
  if (language.isDefault) {
    params.delete('lang');
  } else {
    params.set('lang', language.code);
  }
  // Re-encode segment by segment so encoded and decoded (Arabic) slugs both
  // yield one valid Location.
  const path = rest.map((segment) => encodeURIComponent(safeDecode(segment))).join('/');
  const pathname = `${siteBasePath(input.projectId, input.isCustomDomain)}${path ? `/${path}` : ''}` || '/';
  const query = params.toString();
  return `${pathname}${query ? `?${query}` : ''}`;
}
