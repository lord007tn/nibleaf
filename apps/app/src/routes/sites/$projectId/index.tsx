import { createFileRoute, notFound, redirect } from '@tanstack/react-router';
import { SitePageView } from '@/components/site/site-page-view';
import { getSiteFn, getSitePageFn } from '@/functions/site';
import { ApiResponseError } from '@/hooks/api/client-helpers';
import { customDomainOrigin } from '@/lib/site-origin';
import { isCustomDomainSite } from '@/lib/site-paths';
import { redirectIfConfigured } from '@/lib/site-redirects';
import { pageHead } from '@/lib/site-seo';

export const Route = createFileRoute('/sites/$projectId/')({
  component: SiteHome,
  loaderDeps: ({ search }) => ({ lang: search.lang }),
  // Empty path resolves to the site's first page server-side (content + SEO).
  loader: async ({ params, deps }) => {
    try {
      const page = await getSitePageFn({ data: { projectId: params.projectId, path: '', language: deps.lang } });
      return { page, lang: deps.lang, siteOrigin: customDomainOrigin() };
    } catch (error) {
      if (!(error instanceof ApiResponseError) || error.status !== 404) {
        throw error;
      }
      // A site may intentionally publish only an API reference. Give that
      // reference a useful home URL instead of returning a root 404.
      const site = await getSiteFn({ data: { projectId: params.projectId, language: deps.lang } }).catch(() => null);
      if (site?.openapi) {
        const prefix = isCustomDomainSite(params.projectId) ? '' : `/sites/${params.projectId}`;
        const query = deps.lang ? `?lang=${encodeURIComponent(deps.lang)}` : '';
        throw redirect({ href: `${prefix}/${site.openapi.path}${query}`, statusCode: 302 });
      }
      // Honor a configured redirect for the site root before the not-found
      // state. Mark the SSR response 404 so this soft-404 returns the right
      // status (the head also carries robots noindex).
      await redirectIfConfigured(params.projectId, '', deps.lang);
      // Throw the router's not-found sentinel so TanStack owns the final HTTP
      // status. Mutating the response from inside this streamed loader produced
      // a soft 200 in production.
      throw notFound();
    }
  },
  head: ({ loaderData, params }) => pageHead(loaderData?.page ?? null, params.projectId, loaderData?.lang, loaderData?.siteOrigin),
});

function SiteHome() {
  const { projectId } = Route.useParams();
  // Active language comes from the parent route's ?lang= search param.
  const { lang } = Route.useSearch();
  const { page } = Route.useLoaderData();
  // Empty path resolves to the first page server-side.
  return <SitePageView projectId={projectId} lang={lang} data={page} />;
}
