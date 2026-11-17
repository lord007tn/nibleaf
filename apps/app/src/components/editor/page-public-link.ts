import { publishedPageUrl } from '@/components/project/deploy-pipeline';
import type { PageNode } from '@/hooks/api';
import { siteLanguageParam } from '@/lib/site-paths';

/**
 * A page's address on the published site, built as the reader builds its own
 * links: the site's canonical base (its live custom domain, else its Nibleaf
 * address), the docs version's prefix for a non-default version, the page path,
 * and `?lang=` for any language but the default one.
 */
export function pagePublicLink(
  projectId: string,
  page: Pick<PageNode, 'path' | 'title' | 'languageId'>,
  site: {
    slug?: string;
    primaryDomain?: string;
    languages: ReadonlyArray<{ id: string; code: string; isDefault: boolean }>;
    /** The page's version prefix; unset for the default version. */
    versionSlug?: string;
  },
): string {
  const language = site.languages.find((candidate) => candidate.id === page.languageId)?.code;
  const defaultLanguage = site.languages.find((candidate) => candidate.isDefault)?.code;
  return publishedPageUrl(
    projectId,
    { path: page.path, title: page.title, languageCode: siteLanguageParam(language, defaultLanguage), versionSlug: site.versionSlug },
    { slug: site.slug, primaryDomain: site.primaryDomain },
  );
}
