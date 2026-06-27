import { createFileRoute } from '@tanstack/react-router';
import { SitePageView } from '@/components/site/site-page-view';
import { getData } from '@/hooks/api/client-helpers';
import type { SitePage } from '@/hooks/api/types';
import { api } from '@/lib/api';
import { customDomainOrigin } from '@/lib/site-origin';
import { redirectIfConfigured } from '@/lib/site-redirects';
import { pageHead } from '@/lib/site-seo';

export const Route = createFileRoute('/sites/$projectId/$')({
  component: SitePath,
  loaderDeps: ({ search }) => ({ lang: search.lang }),
  // Server-fetch the page so its content + per-page SEO tags are in the HTML.
  loader: async ({ params, deps }) => {
    try {
      const page = await getData<SitePage>(
        await api.public.sites[':id'].page.$get({
          param: { id: params.projectId },
          query: deps.lang ? { path: params._splat ?? '', lang: deps.lang } : { path: params._splat ?? '' },
        }),
        'page',
      );
      return { page, lang: deps.lang, siteOrigin: customDomainOrigin() };
    } catch {
      // Page didn't resolve — honor a configured redirect (throws a 308) before
      // falling back to the not-found state.
      await redirectIfConfigured(params.projectId, params._splat ?? '', deps.lang);
      return { page: null, lang: deps.lang, siteOrigin: customDomainOrigin() };
    }
  },
  head: ({ loaderData, params }) => pageHead(loaderData?.page ?? null, params.projectId, loaderData?.lang, loaderData?.siteOrigin),
});

function SitePath() {
  const { projectId, _splat } = Route.useParams();
  // Active language comes from the parent route's ?lang= search param.
  const { lang } = Route.useSearch();
  const { page } = Route.useLoaderData();
  return <SitePageView projectId={projectId} path={_splat ?? ''} lang={lang} initialData={page ?? undefined} />;
}
