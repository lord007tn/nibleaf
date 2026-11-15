import { createFileRoute, notFound } from '@tanstack/react-router';
import { SiteChangelogView } from '@/components/site/site-changelog';
import { SiteNotFound } from '@/components/site/site-not-found';
import { getSiteFn, listSiteChangelogFn } from '@/functions/site';
import { ApiResponseError } from '@/hooks/api/client-helpers';
import type { ChangelogEntry, SiteShell } from '@/hooks/api/types';
import { customDomainOrigin } from '@/lib/site-origin';
import { pageHead, readerFallbackHead, siteChangelogHead, siteLanguageFromMatches, unavailableSiteHeadFromMatches } from '@/lib/site-seo';

export const Route = createFileRoute('/sites/$projectId/changelog')({
  component: SiteChangelog,
  // Missing pages stay inside the documentation, in the site's language.
  notFoundComponent: SiteNotFound,
  loaderDeps: ({ search }) => ({ lang: search.lang }),
  // Reuse the parent shell for SSR metadata and client navigation.
  loader: async ({ params, deps, parentMatchPromise }) => {
    let site: SiteShell;
    try {
      const parent = await parentMatchPromise;
      if (parent?.status === 'error') throw parent.error;
      const parentSite = (parent?.loaderData as { site?: SiteShell | null } | undefined)?.site;
      if (parentSite === null) throw notFound();
      site = parentSite ?? (await getSiteFn({ data: { projectId: params.projectId, language: deps.lang } }));
    } catch (error) {
      // A missing or privacy-hidden site is a real 404, not an empty changelog
      // served as 200; other failures reach the retryable error boundary.
      if (error instanceof ApiResponseError && error.status === 404) throw notFound();
      throw error;
    }
    let entries: ChangelogEntry[] = [];
    try {
      entries = await listSiteChangelogFn({ data: { projectId: params.projectId } });
    } catch {
      // The shell still owns SEO/chrome when the optional feed is unavailable.
    }
    return { site, entries, lang: deps.lang, siteOrigin: customDomainOrigin() };
  },
  head: ({ loaderData, params, match, matches }) => {
    if (match.status === 'error') return readerFallbackHead(matches, siteLanguageFromMatches(matches));
    const site = loaderData?.site;
    // A missing site renders the not-found page: no canonical or feed for it.
    if (!site) return unavailableSiteHeadFromMatches(matches) ?? pageHead(null, params.projectId, siteLanguageFromMatches(matches));
    return siteChangelogHead(site, params.projectId, loaderData?.siteOrigin);
  },
});

function SiteChangelog() {
  return <SiteChangelogView {...Route.useLoaderData()} />;
}
