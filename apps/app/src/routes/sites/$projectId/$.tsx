import { siteT } from '@nibleaf/i18n/site';
import { siteLanguagePrefix } from '@nibleaf/shared/site-language';
import { createFileRoute, notFound, redirect } from '@tanstack/react-router';
import { lazy, Suspense } from 'react';
import { SiteArticleSkeleton } from '@/components/site/site-article-skeleton';
import { SiteNotFound } from '@/components/site/site-not-found';
import { SitePageView } from '@/components/site/site-page-view';
import { useSiteReader } from '@/components/site/site-reader-context';
import { getSiteFn, listSiteChangelogFn } from '@/functions/site';
import { ApiResponseError } from '@/hooks/api/client-helpers';
import { sitePageQueryOptions } from '@/hooks/api/site-query-options';
import type { SitePage } from '@/hooks/api/types';
import { isPublicReaderSite } from '@/lib/reader-site-access';
import { customDomainOrigin } from '@/lib/site-origin';
import { siteHref, siteLanguageParam } from '@/lib/site-paths';
import { redirectIfConfigured } from '@/lib/site-redirects';
import {
  pageHead,
  pageMarkdownHeaders,
  readerFallbackHead,
  siteChangelogHead,
  siteLanguageFromMatches,
  sitePageUrl,
  unavailableSiteHeadFromMatches,
} from '@/lib/site-seo';

const ChangelogView = lazy(() => import('@/components/site/site-changelog').then((module) => ({ default: module.SiteChangelogView })));

const OpenApiReferenceView = lazy(() =>
  import('@/components/site/openapi-reference-view').then((module) => ({ default: module.OpenApiReferenceView })),
);

export const Route = createFileRoute('/sites/$projectId/$')({
  component: SitePath,
  // A missing page renders here, inside the reader chrome and in the site's
  // language, instead of the platform-wide not-found screen.
  notFoundComponent: SiteNotFound,
  // Opening another page keeps the reader chrome and shows an article-shaped
  // placeholder (after the router's short pending delay) instead of a
  // full-screen loader.
  pendingComponent: SiteArticleSkeleton,
  loaderDeps: ({ search }) => ({ lang: search.lang }),
  // On a public site, a page shown in the last 30 s (the page query's stale time)
  // is still fresh: Back and Forward reuse it instead of running the loader
  // again. That matters most for the first page, whose data came with the server
  // HTML and is not in the browser's query cache. Private and reader-only sites
  // always load again, so access is checked on every navigation.
  staleTime: 30_000,
  shouldReload: ({ params }) => (isPublicReaderSite(params.projectId) ? undefined : true),
  // Server-fetch the page so its content + per-page SEO tags are in the HTML.
  loader: async ({ params, deps, location, parentMatchPromise, context: { queryClient } }) => {
    const parent = await parentMatchPromise;
    if (parent?.status === 'error') throw parent.error;
    const site = parent?.loaderData?.site;
    const { parseSiteLanguagePath, parseSiteLanguageAlias } = await import('@nibleaf/shared/site-language-prefix');
    const parsed = parseSiteLanguagePath(params._splat ?? '', site?.languages ?? []);
    const lang = parsed.language?.code ?? deps.lang;
    const path = parsed.path;
    const tail = `${location.searchStr}${location.hash ? `#${location.hash.replace(/^#/, '')}` : ''}`;
    if (path === 'changelog' && site) {
      const entries = await listSiteChangelogFn({ data: { projectId: params.projectId } });
      return { kind: 'changelog' as const, entries, site, lang, siteOrigin: customDomainOrigin() };
    }
    const version = path ? path.split('/')[0] : undefined;
    let page: SitePage;
    try {
      // A page preloaded on link hover (or read moments ago) comes from the query
      // cache; once it is stale, the loader waits for the published version again.
      page = await queryClient.query(sitePageQueryOptions(params.projectId, path, lang, version, { fresh: isPublicReaderSite(params.projectId) }));
    } catch (error) {
      if (!(error instanceof ApiResponseError) || error.status !== 404) {
        throw error;
      }
      // The API Reference is a published snapshot resource rather than an MDX
      // page, so it intentionally has no Page row. Resolve its configured path
      // from the access-gated site shell before treating the page miss as 404.
      const referenceSite = await getSiteFn({ data: { projectId: params.projectId, language: lang, version } }).catch(() => null);
      const referenceVersion = referenceSite?.versions.find((item) => item.slug === version);
      const referencePath = referenceVersion ? path.slice(referenceVersion.slug.length).replace(/^\/+/, '') : path;
      if (referenceSite?.openapi) {
        if (!referencePath) {
          // A language/version homepage has the same API-only fallback as the index.
          throw redirect({
            href:
              siteHref(params.projectId, referenceSite.openapi.path, {
                lang: siteLanguageParam(lang, referenceSite.languages.find((item) => item.isDefault)?.code),
                version: referenceVersion && !referenceVersion.isDefault ? referenceVersion.slug : undefined,
                languages: referenceSite.languages,
              }) + tail,
            statusCode: 302,
          });
        }
        if (referencePath === referenceSite.openapi.path) {
          return { kind: 'openapi' as const, openapi: referenceSite.openapi, site: referenceSite, lang, siteOrigin: customDomainOrigin() };
        }
      }
      // Page didn't resolve — honor a configured redirect (throws a 308) before
      // falling back to the not-found state. Mark the SSR response 404 so this
      // soft-404 returns the right status (the head also carries robots noindex).
      await redirectIfConfigured(
        params.projectId,
        path,
        siteLanguageParam(lang, site?.languages.find((item) => item.isDefault)?.code),
        params._splat,
      );
      const alias = parseSiteLanguageAlias(path, site?.languages ?? []);
      if (alias.language) {
        const href =
          siteHref(params.projectId, alias.path, {
            lang: siteLanguageParam(alias.language.code, site?.languages.find((item) => item.isDefault)?.code),
            languages: site?.languages,
          }) + tail;
        throw redirect({ href, statusCode: 308 });
      }
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
      const language = page.languages.some((item) => item.code === lang) ? lang : page.activeLanguage;
      const href =
        siteHref(params.projectId, page.page.path, {
          lang: siteLanguageParam(language, page.languages.find((item) => item.isDefault)?.code),
          version: prefix,
          languages: page.languages,
        }) + tail;
      throw redirect({ href, statusCode: 302 });
    }
    // The article renders in one pass, never a fallback first. Imported here,
    // not at the top: this loader is in every route's first load.
    await import('@/lib/reader-hydration-modules').then((module) => module.loadArticleRenderer(page.page.content));
    return { kind: 'page' as const, page, lang, version, siteOrigin: customDomainOrigin() };
  },
  // Lets the server entry add the Markdown `Link` header from this already
  // loaded page instead of rendering the page a second time to find out.
  headers: ({ loaderData }) => pageMarkdownHeaders(loaderData?.kind === 'page' ? loaderData.page : null, loaderData?.lang),
  head: ({ loaderData, params, match, matches }) => {
    // A page that failed to load (not a 404) still gets the site's name as its title.
    if (match.status === 'error') return readerFallbackHead(matches, siteLanguageFromMatches(matches));
    const unavailable = unavailableSiteHeadFromMatches(matches);
    if (unavailable) return unavailable;
    if (loaderData?.kind === 'changelog') return siteChangelogHead(loaderData.site, params.projectId, loaderData.siteOrigin);
    if (loaderData?.kind === 'openapi') {
      const siteName = loaderData.site.languageConfig?.name || loaderData.site.project.name;
      const title = `${loaderData.openapi.title} — ${siteName}`;
      // The site's own (localized) description; never a fixed English sentence.
      const description = loaderData.site.languageConfig?.description || loaderData.site.project.description;
      const noindex = loaderData.site.project.config?.visibility === 'private';
      const site = loaderData.site;
      const options = { primaryDomain: site.project.primaryDomain, slug: site.project.slug, requestOrigin: loaderData.siteOrigin };
      const version = site.versions.find((item) => item.slug === site.activeVersion && !item.isDefault);
      const resourcePath = [version?.slug, loaderData.openapi.path].filter(Boolean).join('/');
      const resourceUrl = (language?: string) => sitePageUrl(params.projectId, resourcePath, siteLanguagePrefix(language, site.languages), options);
      const defaultCode = site.languages.find((item) => item.isDefault)?.code;

      return {
        meta: [
          { title },
          ...(description ? [{ name: 'description', content: description }] : []),
          ...(noindex ? [{ name: 'robots', content: 'noindex,nofollow' }] : []),
        ],
        links: [
          { rel: 'canonical', href: resourceUrl(siteLanguageParam(site.activeLanguage, defaultCode)) },
          ...(!noindex
            ? site.languages.map((item) => ({ rel: 'alternate', hrefLang: item.code, href: resourceUrl(item.isDefault ? undefined : item.code) }))
            : []),
          ...(!noindex ? [{ rel: 'alternate', hrefLang: 'x-default', href: resourceUrl() }] : []),
        ],
      };
    }
    return pageHead(
      loaderData?.kind === 'page' ? loaderData.page : null,
      params.projectId,
      // A loaded page needs the requested language; a not-found page, the reader's language.
      loaderData ? loaderData.lang : siteLanguageFromMatches(matches),
      loaderData?.siteOrigin,
    );
  },
});

function SitePath() {
  const { projectId } = Route.useParams();
  // Active language comes from the resolved language prefix.
  const data = Route.useLoaderData();
  const lang = data.lang;
  const readerLang = useSiteReader()?.lang;
  if (data.kind === 'changelog')
    return (
      <Suspense fallback={<SiteArticleSkeleton />}>
        <ChangelogView site={data.site} entries={data.entries} />
      </Suspense>
    );
  if (data.kind === 'openapi') {
    return (
      <Suspense fallback={<div className="py-12 text-center text-muted-foreground">{siteT(readerLang ?? lang)('loadingApiReference')}</div>}>
        <OpenApiReferenceView projectId={projectId} />
      </Suspense>
    );
  }
  return <SitePageView projectId={projectId} lang={lang} data={data.page} />;
}
