type OpenApiSchema = Record<string, unknown>;

const errorSchema: OpenApiSchema = {
  type: 'object',
  required: ['error'],
  properties: {
    error: {
      type: 'object',
      required: ['code', 'message'],
      properties: {
        code: { type: 'string', description: 'Stable machine-readable error code.' },
        message: { type: 'string', description: 'Human-readable error summary.' },
        details: { type: 'object', additionalProperties: true },
      },
    },
  },
};

const jsonResponse = (description: string, schema: OpenApiSchema) => ({
  description,
  content: { 'application/json': { schema } },
});

const textResponse = (description: string, mediaType: string) => ({
  description,
  content: { [mediaType]: { schema: { type: 'string' } } },
});

const publicErrors = {
  404: jsonResponse(
    'The site, page, or requested published resource was not found. Private sites also use 404 to avoid existence disclosure.',
    errorSchema,
  ),
  429: jsonResponse('The public request rate limit was exceeded.', errorSchema),
  500: jsonResponse('The request failed unexpectedly.', errorSchema),
};

const siteParameters = [
  {
    name: 'siteId',
    in: 'path',
    required: true,
    description: 'Published project identifier or slug.',
    schema: { type: 'string', minLength: 1 },
  },
];

const languageAndVersionParameters = [
  {
    name: 'lang',
    in: 'query',
    required: false,
    description: 'Requested enabled language code. Falls back to the site default when omitted or unavailable.',
    schema: { type: 'string', minLength: 2, maxLength: 35, examples: ['en', 'ar'] },
  },
  {
    name: 'version',
    in: 'query',
    required: false,
    description: 'Published documentation version slug. Falls back to the default version when omitted or unavailable.',
    schema: { type: 'string', minLength: 1, maxLength: 100 },
  },
];

const publicDataEnvelope = (description: string): OpenApiSchema => ({
  type: 'object',
  required: ['data'],
  properties: {
    data: {
      type: 'object',
      description,
      additionalProperties: true,
    },
  },
});

/** Stable, deliberately bounded contract for Nibleaf's public reader surface.
 * Dashboard/session endpoints are implementation details and are not advertised
 * as a supported third-party write API. */
export function nibleafPublicOpenApi(origin: string) {
  return {
    openapi: '3.1.0',
    info: {
      title: 'Nibleaf Public Reader API',
      version: '1.0.0',
      description:
        'Read published Nibleaf documentation, search public sites, and discover their machine-readable files. This contract covers the public reader surface only; Nibleaf does not currently offer a supported third-party write API.',
      contact: { name: 'Nibleaf product support', email: 'support@nibleaf.com', url: `${origin}/contact` },
      license: { name: 'AGPL-3.0-only', identifier: 'AGPL-3.0-only', url: 'https://www.gnu.org/licenses/agpl-3.0.html' },
    },
    externalDocs: { description: 'Nibleaf API and OpenAPI documentation', url: 'https://docs.nibleaf.com/reference/api' },
    servers: [{ url: origin, description: 'Nibleaf Cloud' }],
    tags: [{ name: 'Published sites', description: 'Read-only access to immutable published documentation and discovery files.' }],
    paths: {
      '/openapi.json': {
        get: {
          operationId: 'getNibleafPublicOpenApi',
          tags: ['Published sites'],
          summary: 'Download this OpenAPI document',
          description: 'Returns the stable OpenAPI 3.1 contract for Nibleaf public reader endpoints.',
          responses: { 200: jsonResponse('The Nibleaf public reader OpenAPI document.', { type: 'object', additionalProperties: true }) },
        },
      },
      '/api/public/sites/{siteId}': {
        get: {
          operationId: 'getPublishedSite',
          tags: ['Published sites'],
          summary: 'Get published site navigation',
          description: 'Returns published site branding, languages, versions, navigation, and the active immutable deployment metadata.',
          parameters: [...siteParameters, ...languageAndVersionParameters],
          responses: {
            200: jsonResponse(
              'Published site shell and navigation.',
              publicDataEnvelope('Published project, languages, versions, navigation, and deployment metadata.'),
            ),
            ...publicErrors,
          },
        },
      },
      '/api/public/sites/{siteId}/page': {
        get: {
          operationId: 'getPublishedPage',
          tags: ['Published sites'],
          summary: 'Get one published page',
          description:
            'Returns one published Markdown/MDX page plus its table of contents, breadcrumbs, neighbours, language, version, and SEO metadata.',
          parameters: [
            ...siteParameters,
            {
              name: 'path',
              in: 'query',
              required: false,
              description: 'Slash-delimited page path. An empty value resolves to the first page.',
              schema: { type: 'string', maxLength: 512, default: '' },
            },
            ...languageAndVersionParameters,
          ],
          responses: {
            200: jsonResponse('Published page and navigation context.', publicDataEnvelope('Published page content and navigation context.')),
            ...publicErrors,
          },
        },
      },
      '/api/public/sites/{siteId}/markdown': {
        get: {
          operationId: 'getPublishedPageMarkdown',
          tags: ['Published sites'],
          summary: 'Get one public page as Markdown',
          description:
            'Returns the clean Markdown alternate for one indexable published page. Private, audience-restricted, hidden, noindex, and externally canonicalized pages return not found.',
          parameters: [
            ...siteParameters,
            {
              name: 'path',
              in: 'query',
              required: false,
              description: 'Slash-delimited page path. An empty value resolves to the first public page.',
              schema: { type: 'string', maxLength: 512, default: '' },
            },
            ...languageAndVersionParameters,
          ],
          responses: { 200: textResponse('Public page Markdown.', 'text/markdown'), ...publicErrors },
        },
      },
      '/api/public/sites/{siteId}/search': {
        get: {
          operationId: 'searchPublishedSite',
          tags: ['Published sites'],
          summary: 'Search a published site',
          description: 'Runs Nibleaf full-text and fuzzy search across all published languages for the selected version.',
          parameters: [
            ...siteParameters,
            {
              name: 'q',
              in: 'query',
              required: false,
              description: 'Search query. The server accepts up to 200 characters.',
              schema: { type: 'string', maxLength: 200, default: '' },
            },
            {
              name: 'limit',
              in: 'query',
              required: false,
              description: 'Maximum number of hits.',
              schema: { type: 'integer', minimum: 1, maximum: 50 },
            },
            ...languageAndVersionParameters,
          ],
          responses: {
            200: jsonResponse('Ranked search hits.', {
              type: 'object',
              required: ['data'],
              properties: {
                data: {
                  type: 'object',
                  required: ['hits'],
                  properties: {
                    hits: {
                      type: 'array',
                      items: {
                        type: 'object',
                        required: ['id', 'title', 'path'],
                        properties: {
                          id: { type: 'string' },
                          title: { type: 'string' },
                          path: { type: 'string' },
                          excerpt: { type: 'string' },
                          score: { type: 'number' },
                        },
                        additionalProperties: true,
                      },
                    },
                  },
                },
              },
            }),
            ...publicErrors,
          },
        },
      },
      '/api/public/sites/{siteId}/openapi.json': {
        get: {
          operationId: 'getPublishedSiteOpenApi',
          tags: ['Published sites'],
          summary: 'Get a site-owned OpenAPI document',
          description: 'Returns the validated OpenAPI 3.x document frozen into the latest published site deployment.',
          parameters: siteParameters,
          responses: {
            200: jsonResponse('The site-owned OpenAPI document.', { type: 'object', additionalProperties: true }),
            304: { description: 'The ETag supplied in If-None-Match is current.' },
            ...publicErrors,
          },
        },
      },
      '/api/public/sites/{siteId}/changelog': {
        get: {
          operationId: 'getPublishedSiteChangelog',
          tags: ['Published sites'],
          summary: 'Get published releases',
          description: 'Returns newest-first immutable READY deployment entries for a published site.',
          parameters: siteParameters,
          responses: {
            200: jsonResponse('Published deployment history.', {
              type: 'object',
              required: ['data'],
              properties: {
                data: {
                  type: 'array',
                  items: {
                    type: 'object',
                    required: ['version', 'date', 'title', 'pages'],
                    properties: {
                      version: { type: 'integer' },
                      date: { type: 'string', format: 'date-time' },
                      title: { type: 'string' },
                      pages: { type: 'integer', minimum: 0 },
                    },
                  },
                },
              },
            }),
            ...publicErrors,
          },
        },
      },
      '/api/public/sites/{siteId}/changelog/rss.xml': {
        get: {
          operationId: 'getPublishedSiteChangelogRss',
          tags: ['Published sites'],
          summary: 'Get releases as RSS',
          description: 'Returns an RSS 2.0 representation of the published deployment history.',
          parameters: siteParameters,
          responses: { 200: textResponse('RSS 2.0 release feed.', 'application/rss+xml'), ...publicErrors },
        },
      },
      '/api/public/sites/{siteId}/sitemap.xml': {
        get: {
          operationId: 'getPublishedSiteSitemap',
          tags: ['Published sites'],
          summary: 'Get the site sitemap',
          description: 'Returns the XML sitemap for indexable pages in the published deployment.',
          parameters: siteParameters,
          responses: { 200: textResponse('XML sitemap.', 'application/xml'), ...publicErrors },
        },
      },
      '/api/public/sites/{siteId}/robots.txt': {
        get: {
          operationId: 'getPublishedSiteRobots',
          tags: ['Published sites'],
          summary: 'Get crawler directives',
          description: 'Returns crawler directives aligned with the site visibility and indexing configuration.',
          parameters: siteParameters,
          responses: { 200: textResponse('robots.txt directives.', 'text/plain'), ...publicErrors },
        },
      },
      '/api/public/sites/{siteId}/llms.txt': {
        get: {
          operationId: 'getPublishedSiteLlmsIndex',
          tags: ['Published sites'],
          summary: 'Get the agent page index',
          description: 'Returns an llmstxt.org-style Markdown index of every indexable page in the published site.',
          parameters: siteParameters,
          responses: { 200: textResponse('Agent-readable page index.', 'text/plain'), ...publicErrors },
        },
      },
      '/api/public/sites/{siteId}/llms-full.txt': {
        get: {
          operationId: 'getPublishedSiteLlmsFull',
          tags: ['Published sites'],
          summary: 'Get all agent-readable page content',
          description: 'Returns concatenated Markdown for every indexable page, with per-page source URLs and metadata.',
          parameters: siteParameters,
          responses: { 200: textResponse('Complete published Markdown corpus.', 'text/plain'), ...publicErrors },
        },
      },
    },
  };
}
