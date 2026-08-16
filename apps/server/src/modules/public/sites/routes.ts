import { errorResponses } from '@/errors/utils';
import { createRouteConfig } from '@/lib/hono/route-config';

const ok = { 200: { description: 'ok' }, ...errorResponses };
const passthrough = (_: unknown, next: () => Promise<void>) => next();

const sitesRoutes = {
  site: createRouteConfig({ guard: passthrough, tags: ['public'], description: 'Published site shell (branding + navigation).', responses: ok }),
  page: createRouteConfig({ guard: passthrough, tags: ['public'], description: 'A published page with TOC and neighbours.', responses: ok }),
  openapi: createRouteConfig({
    guard: passthrough,
    tags: ['public'],
    description: 'The validated OpenAPI document frozen in the latest published deployment.',
    responses: ok,
  }),
  search: createRouteConfig({ guard: passthrough, tags: ['public'], description: 'Search a published site (full-text + fuzzy).', responses: ok }),
  track: createRouteConfig({ guard: passthrough, tags: ['public'], description: 'Record a pageview, search, or feedback event.', responses: ok }),
  changelog: createRouteConfig({ guard: passthrough, tags: ['public'], description: 'Published-version changelog for a site.', responses: ok }),
  sitemap: createRouteConfig({ guard: passthrough, tags: ['public'], description: 'XML sitemap of a published site.', responses: ok }),
  robots: createRouteConfig({ guard: passthrough, tags: ['public'], description: 'robots.txt for a published site.', responses: ok }),
  llms: createRouteConfig({
    guard: passthrough,
    tags: ['public'],
    description: 'llms.txt for a published site (llmstxt.org page index).',
    responses: ok,
  }),
  llmsFull: createRouteConfig({
    guard: passthrough,
    tags: ['public'],
    description: 'llms-full.txt for a published site (full page Markdown).',
    responses: ok,
  }),
};

export default sitesRoutes;
