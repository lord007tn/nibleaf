import { createFileRoute } from '@tanstack/react-router';
import { SitePageView } from '@/components/site/site-page-view';
import { getData } from '@/hooks/api/client-helpers';
import type { SitePage } from '@/hooks/api/types';
import { api } from '@/lib/api';
import { customDomainOrigin } from '@/lib/site-origin';
import { pageHead } from '@/lib/site-seo';

export const Route = createFileRoute('/sites/$projectId/')({
  component: SiteHome,
  loaderDeps: ({ search }) => ({ lang: search.lang }),
  // Empty path resolves to the site's first page server-side (content + SEO).
  loader: async ({ params, deps }) => {
    try {
      const page = await getData<SitePage>(
        await api.api.public.sites[':id'].page.$get({
          param: { id: params.projectId },
          query: deps.lang ? { path: '', lang: deps.lang } : { path: '' },
        }),
        'page',
      );
      return { page, lang: deps.lang, siteOrigin: customDomainOrigin() };
    } catch {
      return { page: null, lang: deps.lang, siteOrigin: customDomainOrigin() };
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
  return <SitePageView projectId={projectId} path="" lang={lang} initialData={page ?? undefined} />;
}
