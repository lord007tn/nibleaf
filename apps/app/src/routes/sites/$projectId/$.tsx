import { createFileRoute, notFound, redirect } from '@tanstack/react-router';
import { lazy, Suspense } from 'react';
import { SitePageView } from '@/components/site/site-page-view';
import { ApiResponseError, getData } from '@/hooks/api/client-helpers';
import type { SitePage, SiteShell } from '@/hooks/api/types';
import { customDomainOrigin } from '@/lib/site-origin';
import { isCustomDomainSite } from '@/lib/site-paths';
import { redirectIfConfigured } from '@/lib/site-redirects';
import { pageHead } from '@/lib/site-seo';
import { api } from '@/services/api';

const OpenApiReferenceView = lazy(() =>
  import('@/components/site/openapi-reference-view').then((module) => ({ default: module.OpenApiReferenceView })),
);

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
      // The API Reference is a published snapshot resource rather than an MDX
      // page, so it intentionally has no Page row. Resolve its configured path
      // from the access-gated site shell before treating the page miss as 404.
      const requested = (params._splat ?? '').replace(/^\/+|\/+$/g, '');
      try {
        const site = await getData<SiteShell>(
          await api.public.sites[':id'].$get({
            param: { id: params.projectId },
            query: { ...(deps.lang ? { lang: deps.lang } : {}) },
          }),
          'site',
        );
        if (site.openapi && requested === site.openapi.path) {
          return { kind: 'openapi' as const, openapi: site.openapi, site, lang: deps.lang, siteOrigin: customDomainOrigin() };
        }
      } catch {
        // Preserve the original page-not-found behavior (and privacy-hiding 404)
        // when the shell is unavailable or the reference is not published.
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
    return { kind: 'page' as const, page, lang: deps.lang, version, siteOrigin: customDomainOrigin() };
  },
  head: ({ loaderData, params }) => {
    if (loaderData?.kind === 'openapi') {
      const title = `${loaderData.openapi.title} — ${loaderData.site.project.name}`;
      const description = `Interactive API reference for ${loaderData.site.project.name}.`;
      const noindex = loaderData.site.project.config?.visibility === 'private';
      return {
        meta: [{ title }, { name: 'description', content: description }, ...(noindex ? [{ name: 'robots', content: 'noindex,nofollow' }] : [])],
      };
    }
    return pageHead(loaderData?.kind === 'page' ? loaderData.page : null, params.projectId, loaderData?.lang, loaderData?.siteOrigin);
  },
});

function SitePath() {
  const { projectId } = Route.useParams();
  // Active language comes from the parent route's ?lang= search param.
  const { lang } = Route.useSearch();
  const data = Route.useLoaderData();
  if (data.kind === 'openapi') {
    return (
      <Suspense fallback={<div className="py-12 text-center text-muted-foreground">Loading API reference…</div>}>
        <OpenApiReferenceView projectId={projectId} />
      </Suspense>
    );
  }
  return <SitePageView projectId={projectId} lang={lang} data={data.page} />;
}
