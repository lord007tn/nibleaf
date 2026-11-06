import { env } from '@/env';
import { useDomains, usePages, useProject } from '@/hooks/api';

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

/** The page whose site path matches an analytics path; tolerates a leading language segment (`ar/guide`). */
export function findPageIdForPath(pages: ReadonlyArray<{ id: string; path: string; kind: string }>, path: string): string | null {
  const target = cleanPath(path);
  const candidates = [target, target.split('/').slice(1).join('/')];
  for (const candidate of candidates) {
    const page = pages.find((entry) => entry.kind === 'PAGE' && cleanPath(entry.path) === candidate);
    if (page) return page.id;
  }
  return null;
}

/**
 * Links from an analytics row to the live page and to the editor, using the
 * same live-site rule as the site overview: a verified custom domain, then the
 * free subdomain when one is configured, then the always-working `/sites/:id`.
 */
export function usePageLinks(projectId: string) {
  const { data: project } = useProject(projectId);
  const { data: domains } = useDomains(projectId);
  const { data: pages } = usePages(projectId);
  const primary = domains?.find((domain) => domain.isPrimary && domain.verified) ?? domains?.find((domain) => domain.verified);
  const baseDomain = env.VITE_SITE_BASE_DOMAIN?.replace(/^\*\./, '').replace(/\.$/, '') || undefined;
  const liveDomain = primary?.domain ?? (project && baseDomain ? `${project.slug}.${baseDomain}` : null);
  const siteRoot = liveDomain ? `https://${liveDomain}` : `/sites/${projectId}`;
  return {
    liveHref: (path: string) => {
      const encoded = encodePath(path);
      return encoded ? `${siteRoot}/${encoded}` : siteRoot;
    },
    editorPageId: (path: string) => (pages ? findPageIdForPath(pages, path) : null),
  };
}
