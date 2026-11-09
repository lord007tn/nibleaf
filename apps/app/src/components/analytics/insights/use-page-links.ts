import { env } from '@/env';
import { useDomains, useLanguages, usePages, useProject } from '@/hooks/api';
import { pickLiveDomain } from '@/hooks/api/domain-state';

const cleanPath = (path: string) => path.replace(/^\/+|\/+$/g, '');

/** Encode each segment once (Arabic slugs arrive raw), keeping the slashes. */
const encodePath = (path: string) =>
  cleanPath(path)
    .split('/')
    .map((segment) => {
      try {
        return encodeURIComponent(decodeURIComponent(segment));
      } catch {
        return encodeURIComponent(segment);
      }
    })
    .join('/');

const decodePath = (path: string) => {
  try {
    return decodeURIComponent(path);
  } catch {
    return path;
  }
};

/**
 * The page an analytics path points at, in the right language. A leading
 * segment is treated as a language only when it is one of the site's
 * non-default language codes (`ar/guide`); otherwise the path is matched in
 * the default language. An ambiguous match returns null instead of guessing,
 * so Edit never opens the English page for an Arabic row, or an unrelated page
 * that happens to share the rest of a path.
 */
export function findPageIdForPath(
  pages: ReadonlyArray<{ id: string; path: string; kind: string; languageId?: string }>,
  path: string,
  languages: ReadonlyArray<{ id: string; code: string; isDefault: boolean }> = [],
): string | null {
  const target = cleanPath(decodePath(path));
  const [first = '', ...rest] = target.split('/');
  const prefixed = languages.find((language) => !language.isDefault && language.code.toLowerCase() === first.toLowerCase());
  const wanted = prefixed ? rest.join('/') : target;
  const languageId = prefixed?.id ?? languages.find((language) => language.isDefault)?.id;
  const matches = pages.filter((page) => page.kind === 'PAGE' && cleanPath(decodePath(page.path)) === wanted);
  const inLanguage = languageId ? matches.filter((page) => page.languageId === languageId) : matches;
  return inLanguage.length === 1 ? (inLanguage[0]?.id ?? null) : null;
}

/**
 * Links from an analytics row to the live page and to the editor, using the
 * same live-site rule as the site overview: a live custom domain, then the
 * free subdomain when one is configured, then the always-working `/sites/:id`.
 */
export function usePageLinks(projectId: string) {
  const { data: project } = useProject(projectId);
  const { data: domains } = useDomains(projectId);
  const { data: pages } = usePages(projectId);
  const { data: languages } = useLanguages(projectId);
  // Only a domain readers can actually open (ownership, DNS and HTTPS), as on the site overview.
  const primary = domains ? pickLiveDomain(domains) : undefined;
  const baseDomain = env.VITE_SITE_BASE_DOMAIN?.replace(/^\*\./, '').replace(/\.$/, '') || undefined;
  const liveDomain = primary?.domain ?? (project && baseDomain ? `${project.slug}.${baseDomain}` : null);
  const siteRoot = liveDomain ? `https://${liveDomain}` : `/sites/${projectId}`;
  return {
    liveHref: (path: string) => {
      const encoded = encodePath(path);
      return encoded ? `${siteRoot}/${encoded}` : siteRoot;
    },
    // Unknown until the languages are read: a guess could open the wrong language's page.
    editorPageId: (path: string) => (pages && languages ? findPageIdForPath(pages, path, languages) : null),
  };
}
