import { createFileRoute, notFound, redirect } from '@tanstack/react-router';
import { SitePageView } from '@/components/site/site-page-view';
import { ApiResponseError, getData } from '@/hooks/api/client-helpers';
import type { SitePage } from '@/hooks/api/types';
import { api } from '@/lib/api';
import { customDomainOrigin } from '@/lib/site-origin';
import { isCustomDomainSite } from '@/lib/site-paths';
import { redirectIfConfigured } from '@/lib/site-redirects';
import { pageHead } from '@/lib/site-seo';

export const Route = createFileRoute('/sites/$projectId/$')({
  component: SitePath,
  loaderDeps: ({ search }) => ({ lang: search.lang }),
  // Server-fetch the page so its content + per-page SEO tags are in the HTML.
  loader: async ({ params, deps }) => {
    const path = params._splat ?? '';
    const version = path ? path.split('/')[0] : undefined;
    let page: SitePage;
    try {
      page = await getData<SitePage>(
        await api.public.sites[':id'].page.$get({
          param: { id: params.projectId },
          query: { path, ...(deps.lang ? { lang: deps.lang } : {}), ...(version ? { version } : {}) },
        }),
        'page',
      );
    } catch (error) {
      if (!(error instanceof ApiResponseError) || error.status !== 404) {
        throw error;
      }
      // Page didn't resolve — honor a configured redirect (throws a 308) before
      // falling back to the not-found state. Mark the SSR response 404 so this
      // soft-404 returns the right status (the head also carries robots noindex).
      await redirectIfConfigured(params.projectId, params._splat ?? '', deps.lang);
      // The router's not-found sentinel sets the final streamed response status.
      // The earlier response-context mutation was proven to return HTTP 200 in
      // production even though the page rendered a noindex not-found shell.
      throw notFound();
    }
    // A group/section URL (e.g. a navbar tab's `/guides`) resolves server-side
    // to its first page — hop to that page's real URL so the sidebar highlight,
    // canonical, and share links all agree. (Thrown outside the try so the
    // redirect isn't swallowed by the 404 fallback.)
    const requested = path.replace(/^\/+|\/+$/g, '');
    const resolvedVersion = page.versions.find((item) => item.slug === page.activeVersion);
    const prefix = resolvedVersion && !resolvedVersion.isDefault ? resolvedVersion.slug : undefined;
    const requestedContent =
      prefix && (requested === prefix || requested.startsWith(`${prefix}/`)) ? requested.slice(prefix.length).replace(/^\/+/, '') : requested;
    // Compare decoded so an encoded splat (Arabic slugs) never loops the redirect.
    const safeDecode = (value: string): string => {
      try {
        return decodeURIComponent(value);
      } catch {
        return value;
      }
    };
    if (requestedContent && safeDecode(requestedContent) !== page.page.path) {
      const target = [prefix, page.page.path].filter(Boolean).join('/');
      const query = deps.lang ? `?lang=${encodeURIComponent(deps.lang)}` : '';
      const href = isCustomDomainSite(params.projectId) ? `/${target}${query}` : `/sites/${params.projectId}/${target}${query}`;
      throw redirect({ href, statusCode: 302 });
    }
    return { page, lang: deps.lang, version, siteOrigin: customDomainOrigin() };
  },
  head: ({ loaderData, params }) => pageHead(loaderData?.page ?? null, params.projectId, loaderData?.lang, loaderData?.siteOrigin),
});

function SitePath() {
  const { projectId } = Route.useParams();
  // Active language comes from the parent route's ?lang= search param.
  const { lang } = Route.useSearch();
  const { page } = Route.useLoaderData();
  return <SitePageView projectId={projectId} lang={lang} data={page} />;
}
