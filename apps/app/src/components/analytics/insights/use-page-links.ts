import { useQueries } from '@tanstack/react-query';
import { env } from '@/env';
import { useBranches, useDomains, usePages, useProject } from '@/hooks/api';
import { pickLiveDomain } from '@/hooks/api/domain-state';
import { pagesQueryOptions } from '@/hooks/api/query-options';

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
 * The editor page an analytics path points at, only when it is unambiguous.
 * Readers carry the language in `?lang=` (recorded apart from the path), so a
 * leading segment is never a language and is never stripped, and one path can
 * be the same article in several languages. Analytics doesn't say which
 * language or version a row is, so a path shared by more than one page gets no
 * Edit link rather than a guess that could open the wrong document.
 */
export function findPageIdForPath(
  pages: ReadonlyArray<{ id: string; path: string; kind: string }>,
  path: string,
  otherVersionPages: ReadonlyArray<{ path: string; kind: string }> = [],
): string | null {
  const target = cleanPath(decodePath(path));
  const isTarget = (page: { path: string; kind: string }) => page.kind === 'PAGE' && cleanPath(decodePath(page.path)) === target;
  const matches = pages.filter(isTarget);
  // The same path in another version is another document the row may be about.
  if (otherVersionPages.some(isTarget)) return null;
  return matches.length === 1 ? (matches[0]?.id ?? null) : null;
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
  // Every other version's pages too: a path is only unambiguous across all of them.
  const { data: branches } = useBranches(projectId);
  const otherVersions = useQueries({
    queries: (branches ?? []).filter((branch) => !branch.isDefault).map((branch) => pagesQueryOptions(projectId, undefined, branch.id)),
  });
  const otherVersionsReady = branches !== undefined && otherVersions.every((query) => query.isSuccess);
  const otherVersionPages = otherVersions.flatMap((query) => query.data ?? []);
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
    // Unknown until every version is read: a guess could open the wrong document.
    editorPageId: (path: string) => (pages && otherVersionsReady ? findPageIdForPath(pages, path, otherVersionPages) : null),
  };
}
