import { appendResponseHeader, getRequest, getRequestHeader, setCookie, setResponseHeader, setResponseStatus } from '@tanstack/react-start/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SitePage } from '@/hooks/api/types';
import { pageHead, pageMarkdownHeaders, SITE_MARKDOWN_ALTERNATE_HEADER } from '@/lib/site-seo';

const mocks = vi.hoisted(() => ({
  got: vi.fn(),
  startHandler: vi.fn(async () => new Response('<!doctype html><title>Published</title>', { headers: { 'content-type': 'text/html' } })),
}));

vi.mock('@tanstack/react-start/server', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tanstack/react-start/server')>()),
  createStartHandler: () => mocks.startHandler,
  defaultStreamHandler: vi.fn(),
}));
vi.mock('got', () => ({ default: mocks.got }));
// These published-route tests do not exercise marketing articles/translations.
vi.mock('@nibleaf/i18n', () => ({ translateFn: () => 'synthetic translation' }));
vi.mock('@/lib/blog', () => ({ BLOG_ENTRIES: [] }));
vi.mock('@/env.server', () => ({
  serverEnv: {
    APP_URL: 'http://localhost:4310',
    CUSTOM_DOMAIN_EDGE_SECRET: '',
    INTERNAL_API_SECRET: '',
    PORT: 4310,
    TRUSTED_PROXY_HOPS: 0,
  },
}));

import server, { resolveSiteSlug, slugCacheSize } from './server';

const upstream = (body: unknown, statusCode = 200) => ({ body, ok: statusCode >= 200 && statusCode < 300, statusCode, headers: {} });

describe('published Markdown edge routing', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.startHandler
      .mockReset()
      .mockResolvedValue(new Response('<!doctype html><title>Published</title>', { headers: { 'content-type': 'text/html' } }));
    mocks.got.mockImplementation(async (url: string) => {
      if (url.includes('/api/public/domains/resolve?host=docs-index-test.example')) {
        return upstream({ data: { projectId: 'project-1' } });
      }
      if (url.endsWith('/api/public/sites/project-1')) {
        return upstream({
          data: {
            project: { config: { visibility: 'public' }, primaryDomain: null },
            languages: [
              { code: 'en', isDefault: true },
              { code: 'ar', isDefault: false },
            ],
          },
        });
      }
      if (url.includes('/api/public/sites/project-1/markdown?')) return upstream('# المقدمة\n');
      throw new Error(`Unexpected URL: ${url}`);
    });
  });

  it.each(['http://localhost:4310/sites/project-1/og/intro.png?lang=ar', 'https://docs-index-test.example/og/intro.png?lang=ar'])(
    'proxies binary OG cards and conditional headers on %s',
    async (url) => {
      mocks.got.mockImplementation(async (target: string) =>
        target.includes('/og/') ? { ...upstream(Buffer.from('png')), headers: { etag: '"card"' } } : upstream({ data: { projectId: 'project-1' } }),
      );
      const response = await server.fetch(new Request(url, { headers: { 'if-none-match': '"previous"' } }));
      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toBe('image/png');
      expect(response.headers.get('etag')).toBe('"card"');
      expect(await response.text()).toBe('png');
      const call = mocks.got.mock.calls.find(([target]) => String(target).includes('/og/'));
      expect(call?.[0]).toContain('/api/public/sites/project-1/og/intro.png?lang=ar');
      expect(call?.[1]).toMatchObject({ responseType: 'buffer', headers: { 'if-none-match': '"previous"' } });
      expect(mocks.startHandler).not.toHaveBeenCalled();
    },
  );

  it('preserves private OG refusals and never falls through to HTML', async () => {
    mocks.got.mockResolvedValueOnce(upstream('', 404));
    const response = await server.fetch(new Request('http://localhost:4310/sites/project-1/og/intro.png'));
    expect(response.status).toBe(404);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(mocks.startHandler).not.toHaveBeenCalled();
  });

  it.each(['/', '/ar', '/pricing', '/sign-in', '/dashboard', '/sites/project-1/intro'])(
    'keeps nonce HTML private on %s, even when credentials are present',
    async (path) => {
      const responses: Response[] = [];
      for (const cookie of ['', 'better-auth.session_token=fixture']) {
        mocks.startHandler.mockResolvedValueOnce(new Response('<!doctype html><title>Page</title>', { headers: { 'content-type': 'text/html' } }));
        responses.push(await server.fetch(new Request(`http://localhost:4310${path}`, { headers: { accept: 'text/html', cookie } })));
      }
      for (const response of responses) {
        expect(response.headers.get('cache-control')).toBe('private, no-store');
        expect(response.headers.get('content-security-policy')).toContain("'nonce-");
      }
      expect(responses[0]?.headers.get('content-security-policy')).not.toBe(responses[1]?.headers.get('content-security-policy'));
    },
  );

  it('decodes an Arabic pathname once before proxying and keeps its discovery URL singly encoded', async () => {
    const response = await server.fetch(
      new Request('http://localhost:4310/sites/project-1/ar/%D8%A7%D9%84%D9%85%D9%82%D8%AF%D9%85%D8%A9', {
        headers: { accept: 'text/markdown' },
      }),
    );
    const markdownCall = mocks.got.mock.calls.find(([url]) => String(url).includes('/markdown?'));
    const proxiedUrl = new URL(String(markdownCall?.[0]));

    expect(response.status).toBe(200);
    expect(await response.text()).toBe('# المقدمة\n');
    expect(proxiedUrl.searchParams.get('path')).toBe('المقدمة');
    expect(proxiedUrl.searchParams.get('lang')).toBe('ar');
    expect(response.headers.get('link')).toContain('/sites/project-1/ar/%D8%A7%D9%84%D9%85%D9%82%D8%AF%D9%85%D8%A9.md');
    expect(response.headers.get('link')).not.toContain('%25D8');
  });

  it('keeps an index page distinct from the root Markdown alias', async () => {
    await server.fetch(new Request('https://docs-index-test.example/index.md', { headers: { accept: 'text/markdown' } }));
    await server.fetch(new Request('https://docs-index-test.example/_index.md', { headers: { accept: 'text/markdown' } }));

    const markdownCalls = mocks.got.mock.calls.filter(([url]) => String(url).includes('/markdown?'));
    expect(new URL(String(markdownCalls[0]?.[0])).searchParams.get('path')).toBe('index');
    expect(new URL(String(markdownCalls[1]?.[0])).searchParams.get('path')).toBe('');
  });

  describe.each(['https://client-origin.example', 'not-an-origin://[malformed'])('client site origin %s', (spoofed) => {
    it.each(['/sites/project-1/intro', '/sites/project-1/intro.md'])('uses the app origin for Markdown discovery on %s', async (path) => {
      const response = await server.fetch(
        new Request(`http://localhost:4310${path}`, {
          headers: { accept: path.endsWith('.md') ? 'text/html' : 'text/markdown', 'x-nibleaf-site-origin': spoofed },
        }),
      );
      expect(response.status).toBe(200);
      expect(response.headers.get('link')).toContain('http://localhost:4310/sites/project-1/intro.md');
      expect(response.headers.get('content-location')).toBe('http://localhost:4310/sites/project-1/intro.md');
      expect(response.headers.get('link')).not.toContain(spoofed);
      expect(response.headers.get('content-location')).not.toContain(spoofed);
    });

    it.each(['/sites/project-1/missing', '/sites/project-1/missing.md'])(
      'uses the app origin in the Markdown-unavailable response on %s',
      async (path) => {
        const normalUpstream = mocks.got.getMockImplementation();
        mocks.got.mockImplementation(async (url: string) => (url.includes('/markdown?') ? upstream('Not found', 404) : normalUpstream?.(url)));
        const response = await server.fetch(
          new Request(`http://localhost:4310${path}`, {
            headers: { accept: path.endsWith('.md') ? 'text/html' : 'text/markdown', 'x-nibleaf-site-origin': spoofed },
          }),
        );
        expect(response.status).toBe(404);
        const body = await response.text();
        expect(body).toContain('http://localhost:4310/sites/project-1');
        expect(body).not.toContain(spoofed);
        expect(response.headers.get('link') ?? '').not.toContain(spoofed);
        expect(response.headers.get('content-location') ?? '').not.toContain(spoofed);
      },
    );
  });

  it('preserves a server-function POST body while stripping the client site origin', async () => {
    const body = JSON.stringify({ value: 'synthetic payload', locale: 'ar' });
    mocks.startHandler.mockImplementationOnce(async () => {
      const request = getRequest();
      expect(request.method).toBe('POST');
      expect(request.headers.get('x-nibleaf-site-origin')).toBeNull();
      expect(request.headers.get('content-type')).toBe('application/json');
      expect(await request.text()).toBe(body);
      return new Response('received');
    });
    const response = await server.fetch(
      new Request('http://localhost:4310/_serverFn/synthetic', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-nibleaf-site-origin': 'https://client-origin.example' },
        body,
      }),
    );
    expect(response.status).toBe(200);
    expect(await response.text()).toBe('received');
  });

  it.each(['/api-reference', '/sites-guide', '/assets-guide', '/favicon-guide', '/apis'])(
    'stamps a verified custom origin and serves published slug %s',
    async (path) => {
      const origin = 'https://docs-index-test.example';
      mocks.startHandler.mockImplementationOnce(async () => {
        const request = getRequest();
        expect(new URL(request.url).pathname).toBe(`/sites/project-1${path}`);
        expect(request.headers.get('x-nibleaf-site-origin')).toBe(origin);
        const data: SitePage = {
          project: { id: 'project-1', name: 'Docs', slug: 'docs', description: null, primaryDomain: null, config: { visibility: 'public' } },
          activeLanguage: 'en',
          activeVersion: 'main',
          versions: [{ id: 'main', name: 'main', slug: 'main', isDefault: true }],
          page: {
            id: 'page-1',
            title: 'Guide',
            path: path.slice(1),
            description: null,
            excerpt: '',
            icon: null,
            content: '',
            headings: [],
            config: null,
            createdAt: '2026-10-30',
            updatedAt: '2026-10-30',
          },
          languageConfig: null,
          languages: [{ code: 'en', isDefault: true, path: path.slice(1) }],
          breadcrumbs: [],
          prev: null,
          next: null,
        };
        const head = pageHead(data, 'project-1', 'en', request.headers.get('x-nibleaf-site-origin') ?? undefined);
        expect(head.links?.find((link) => link.rel === 'canonical')?.href).toBe(`${origin}${path}`);
        expect(head.meta?.find((meta) => meta.property === 'og:url')?.content).toBe(`${origin}${path}`);
        expect(head.links?.find((link) => link.type === 'text/markdown')?.href).toBe(`${origin}${path}.md`);
        // The page route flags the SSR response from the page it loaded.
        return new Response('<!doctype html><title>Guide</title>', { headers: { 'content-type': 'text/html', ...pageMarkdownHeaders(data) } });
      });
      const response = await server.fetch(
        new Request(`${origin}${path}`, { headers: { accept: 'text/html', 'x-nibleaf-site-origin': 'https://client-origin.example' } }),
      );
      expect(response.status).toBe(200);
      expect(response.headers.get('link')).toContain(`${origin}${path}.md`);
      expect(response.headers.get(SITE_MARKDOWN_ALTERNATE_HEADER)).toBeNull();
      expect(mocks.startHandler).toHaveBeenCalledOnce();
      // The HTML never waits on a second, full Markdown render to decide the header.
      expect(mocks.got.mock.calls.some(([url]) => String(url).includes('/markdown?'))).toBe(false);
    },
  );

  it('omits HTML discovery when the page route did not flag a public Markdown alternate', async () => {
    const response = await server.fetch(new Request('http://localhost:4310/sites/project-1/authentication', { headers: { accept: 'text/html' } }));

    expect(response.status).toBe(200);
    expect(response.headers.get('link')).toBeNull();
    expect(mocks.got.mock.calls.some(([url]) => String(url).includes('/markdown?'))).toBe(false);
  });

  it('never advertises Markdown for a private site, even when flagged, and strips the internal flag', async () => {
    // Its own project: the site metadata cache already holds project-1 as public.
    mocks.got.mockImplementation(async (url: string) => {
      if (url.endsWith('/api/public/sites/private-project')) {
        return upstream({ data: { project: { config: { visibility: 'private' }, primaryDomain: null } } });
      }
      throw new Error(`Unexpected URL: ${url}`);
    });
    mocks.startHandler.mockResolvedValueOnce(
      new Response('<!doctype html>', { headers: { 'content-type': 'text/html', [SITE_MARKDOWN_ALTERNATE_HEADER]: '1' } }),
    );

    const response = await server.fetch(
      new Request('http://localhost:4310/sites/private-project/authentication', { headers: { accept: 'text/html' } }),
    );

    expect(response.headers.get('link')).toBeNull();
    expect(response.headers.get(SITE_MARKDOWN_ALTERNATE_HEADER)).toBeNull();
  });

  it.each(['/sites/project-1/v1.0', '/sites/project-1/sdk/node.js'])('never leaks the internal Markdown flag on dotted path %s', async (path) => {
    mocks.startHandler.mockResolvedValueOnce(
      new Response('<!doctype html>', { headers: { 'content-type': 'text/html', [SITE_MARKDOWN_ALTERNATE_HEADER]: '1' } }),
    );

    const response = await server.fetch(new Request(`http://localhost:4310${path}`, { headers: { accept: 'text/html' } }));

    expect(mocks.startHandler).toHaveBeenCalledOnce();
    expect(response.headers.get(SITE_MARKDOWN_ALTERNATE_HEADER)).toBeNull();
  });

  it('fails closed for a malformed escape without calling the Markdown endpoint', async () => {
    const response = await server.fetch(new Request('http://localhost:4310/sites/project-1/%E0%A4%A', { headers: { accept: 'text/markdown' } }));

    expect(response.status).toBe(400);
    expect(mocks.startHandler).not.toHaveBeenCalled();
    expect(mocks.got.mock.calls.some(([url]) => String(url).includes('/markdown?'))).toBe(false);
  });

  it('preserves a thrown endpoint-specific Response through the custom entry', async () => {
    mocks.startHandler.mockRejectedValueOnce(new Response('Reader access required', { status: 401, headers: { 'www-authenticate': 'Bearer' } }));

    const response = await server.fetch(new Request('http://localhost:4310/app'));

    expect(response.status).toBe(401);
    expect(await response.text()).toBe('Reader access required');
    expect(response.headers.get('www-authenticate')).toBe('Bearer');
    expect(response.headers.get('x-nibleaf-revision')).toBe('development');
  });

  it.each(['GET', 'HEAD'])('marks an HTML not-found %s response as non-indexable', async (method) => {
    mocks.startHandler.mockResolvedValueOnce(
      new Response(method === 'HEAD' ? null : '<!doctype html><title>Not found</title>', {
        status: 404,
        headers: { 'content-type': 'text/html' },
      }),
    );

    const response = await server.fetch(new Request('http://localhost:4310/sites/%24projectId', { method, headers: { accept: 'text/html' } }));

    expect(response.status).toBe(404);
    expect(response.headers.get('x-robots-tag')).toBe('noindex, nofollow');
    expect(response.headers.get('x-nibleaf-revision')).toBe('development');
    if (method === 'HEAD') expect(await response.text()).toBe('');
  });

  it('does not force noindex onto an indexable successful HTML response', async () => {
    const response = await server.fetch(new Request('http://localhost:4310/sites/project-1', { headers: { accept: 'text/html' } }));

    expect(response.status).toBe(200);
    expect(response.headers.get('x-robots-tag')).toBeNull();
    expect(await response.text()).toContain('<title>Published</title>');
  });

  it('converts errors in a rewritten request before losing its helper status, headers and cookies', async () => {
    let rewrittenPath = '';
    mocks.startHandler.mockImplementationOnce(async () => {
      rewrittenPath = new URL(getRequest().url).pathname;
      setResponseStatus(429, 'Too Many Requests');
      setResponseHeader('retry-after', '30');
      setCookie('nibleaf-entry-test', 'first');
      appendResponseHeader('set-cookie', 'nibleaf-entry-extra=second; Path=/');
      throw Object.assign(new Error('Private upstream failure'), { status: 403 });
    });

    const response = await server.fetch(new Request('https://docs-index-test.example/introduction', { headers: { accept: 'text/html' } }));

    expect(rewrittenPath).toBe('/sites/project-1/introduction');
    expect(response.status).toBe(429);
    expect(response.headers.get('retry-after')).toBe('30');
    expect(response.headers.getSetCookie()).toEqual(
      expect.arrayContaining([expect.stringContaining('nibleaf-entry-test=first'), 'nibleaf-entry-extra=second; Path=/']),
    );
    expect(await response.text()).not.toContain('Private upstream failure');
  });

  it('does not send a successful helper status after an uncaught error', async () => {
    mocks.startHandler.mockImplementationOnce(async () => {
      setResponseStatus(201);
      throw Object.assign(new Error('Unavailable'), { status: 503 });
    });
    const response = await server.fetch(new Request('http://localhost:4310/app'));
    expect(response.status).toBe(503);
  });

  it.each([undefined, null, false, 0, ''])('converts a falsy thrown value (%s) into an error Response', async (error) => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      mocks.startHandler.mockRejectedValueOnce(error);
      const response = await server.fetch(new Request('http://localhost:4310/app'));
      expect(response.status).toBe(500);
      expect(response.headers.get('content-type')).toContain('application/json');
    } finally {
      log.mockRestore();
    }
  });

  it('keeps missing and present-but-empty headers distinct inside the entry', async () => {
    mocks.startHandler.mockImplementationOnce(async () => {
      expect(getRequestHeader('x-absent')).toBeUndefined();
      expect(getRequestHeader('x-empty')).toBe('');
      return new Response('ok');
    });
    const response = await server.fetch(new Request('http://localhost:4310/app', { headers: { 'x-empty': '' } }));
    expect(await response.text()).toBe('ok');
  });
});

describe('machine files of a site the visitor cannot read', () => {
  it('keeps the not-found answer out of shared caches and search results', async () => {
    mocks.got.mockImplementation(async (url: string) => {
      if (url.includes('/api/public/sites/private-project/')) return upstream({ error: 'not found' }, 404);
      throw new Error(`Unexpected URL: ${url}`);
    });
    for (const file of ['llms.txt', 'llms-full.txt', 'sitemap.xml', 'changelog/rss.xml']) {
      const response = await server.fetch(new Request(`http://localhost:4310/sites/private-project/${file}`));
      expect(response.status, file).toBe(404);
      expect(response.headers.get('cache-control'), file).toBe('private, no-store');
      expect(response.headers.get('x-robots-tag'), file).toBe('noindex, nofollow');
    }
  });
});

describe('machine files for a signed-in reader of a private site', () => {
  const privateHeaders = { 'cache-control': 'private, no-store', vary: 'Cookie, Authorization', 'x-robots-tag': 'noindex, nofollow' };
  const privateUpstream = (body: string) => ({ body, ok: true, statusCode: 200, headers: privateHeaders });

  it('sends the reader’s session with a Markdown request and keeps the answer private', async () => {
    mocks.got.mockImplementation(async (url: string) => {
      if (url.endsWith('/api/public/sites/private-reader-project')) {
        return upstream({ data: { project: { config: { visibility: 'private' }, primaryDomain: null } } });
      }
      if (url.includes('/api/public/sites/private-reader-project/markdown?')) return privateUpstream('# Confidential\n');
      throw new Error(`Unexpected URL: ${url}`);
    });
    const response = await server.fetch(
      new Request('http://localhost:4310/sites/private-reader-project/guide.md', {
        headers: { cookie: 'nibleaf_reader_private-reader-project=token' },
      }),
    );
    expect(response.status).toBe(200);
    expect(await response.text()).toBe('# Confidential\n');
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(response.headers.get('vary')).toContain('Cookie');
    expect(response.headers.get('x-robots-tag')).toBe('noindex, nofollow');
    const markdownCall = mocks.got.mock.calls.find(([url]) => String(url).includes('/markdown?'));
    expect((markdownCall?.[1] as { headers?: Record<string, string> })?.headers?.cookie).toBe('nibleaf_reader_private-reader-project=token');
  });

  it('keeps llms.txt private for the reader', async () => {
    mocks.got.mockImplementation(async (url: string) => {
      if (url.includes('/api/public/sites/private-reader-project/llms.txt')) return privateUpstream('# Docs\n');
      throw new Error(`Unexpected URL: ${url}`);
    });
    const response = await server.fetch(
      new Request('http://localhost:4310/sites/private-reader-project/llms.txt', {
        headers: { cookie: 'nibleaf_reader_private-reader-project=token' },
      }),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(response.headers.get('x-robots-tag')).toBe('noindex, nofollow');
  });
});

describe('/sites/<slug> on the platform host', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.startHandler
      .mockReset()
      .mockResolvedValue(new Response('<!doctype html><title>Published</title>', { headers: { 'content-type': 'text/html' } }));
    mocks.got.mockImplementation(async (url: string) => {
      // The slug isn't a site id, so the shell lookup finds nothing.
      if (url.includes('/api/public/sites/')) return upstream({ error: { code: 'not_found' } }, 404);
      if (url.includes('/api/public/domains/slug?slug=jood-pms')) return upstream({ data: { projectId: 'cmsiteid0001' } });
      if (url.includes('/api/public/domains/slug?slug=')) return upstream({ data: { projectId: null } }, 404);
      throw new Error(`Unexpected URL: ${url}`);
    });
  });

  it("sends an address written with a live site's slug to the site, keeping the path and query", async () => {
    const response = await server.fetch(new Request('http://localhost:4310/sites/JOOD-PMS/guide/setup?lang=ar'));
    expect(response.status).toBe(301);
    // Relative: the browser keeps the scheme and host it used, whatever the proxy forwarded.
    expect(response.headers.get('location')).toBe('/sites/cmsiteid0001/guide/setup?lang=ar');
    // A slug can be renamed and taken by another site: the browser must not keep this redirect.
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(mocks.startHandler).not.toHaveBeenCalled();
  });

  it('keeps the Markdown address the reader asked for', async () => {
    const response = await server.fetch(new Request('http://localhost:4310/sites/jood-pms/guide/setup.md'));
    expect(response.status).toBe(301);
    expect(response.headers.get('location')).toBe('/sites/cmsiteid0001/guide/setup.md');
  });

  it('renders the page as before when no live site has that slug', async () => {
    const response = await server.fetch(new Request('http://localhost:4310/sites/nobody-here'));
    expect(response.status).toBe(200);
    expect(mocks.startHandler).toHaveBeenCalled();
  });

  it('looks up only what can be a slug', async () => {
    for (const address of ['a_b', 'has space', 'x'.repeat(64), '-leading', 'dé', '']) {
      mocks.got.mockClear();
      expect(await resolveSiteSlug(address), address).toBeNull();
      expect(
        mocks.got.mock.calls.some(([url]) => String(url).includes('/domains/slug')),
        address,
      ).toBe(false);
    }
  });

  it('keeps at most 1,000 slug answers, and never keeps a failed lookup', async () => {
    mocks.got.mockImplementation(async () => upstream({ data: { projectId: null } }));
    for (let index = 0; index < 1100; index += 1) await resolveSiteSlug(`unknown-${index}`);
    expect(slugCacheSize()).toBe(1000);

    mocks.got.mockReset().mockRejectedValue(new Error('upstream down'));
    const before = slugCacheSize();
    expect(await resolveSiteSlug('fresh-slug')).toBeNull();
    expect(slugCacheSize()).toBe(before);
    mocks.got.mockReset().mockImplementation(async () => upstream({ data: { projectId: 'cmsiteid0002' } }));
    // Tried again, not answered from a remembered failure.
    expect(await resolveSiteSlug('fresh-slug')).toBe('cmsiteid0002');
  });
});

describe('published language path migration (HTTP edge)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.startHandler.mockImplementation(async () => new Response('<html>fixture</html>', { headers: { 'content-type': 'text/html' } }));
    mocks.got.mockImplementation(async (target: string) => {
      if (target.includes('/domains/resolve?')) return upstream({ data: { projectId: 'language-paths-014' } });
      if (target.includes('/markdown?')) return upstream('# Arabic fixture');
      if (target.endsWith('/api/public/sites/language-paths-014'))
        return upstream({
          data: {
            project: { config: { visibility: 'public' }, primaryDomain: null },
            languages: [
              { code: 'en', isDefault: true },
              { code: 'ar', isDefault: false },
            ],
          },
        });
      throw new Error(`Unexpected URL: ${target}`);
    });
  });
  for (const origin of [
    'http://localhost:4310/sites/language-paths-014',
    'https://docs-language-paths.example',
    'https://language-paths.nibleaf.com',
  ]) {
    for (const version of ['', 'v2/'])
      for (const extension of ['', '.md'])
        for (const language of ['en', 'ar']) {
          it(`308 ${origin} ${version}guide${extension}?lang=${language}`, async () => {
            const path = `${version}guide${extension}`;
            const response = await server.fetch(new Request(`${origin}/${path}?lang=${language}&tab=cli&tag=a&tag=b`));
            expect(response.status).toBe(308);
            const base = origin.includes('/sites/') ? '/sites/language-paths-014' : '';
            expect(response.headers.get('location')).toBe(`${base}/${language === 'ar' ? 'ar/' : ''}${path}?tab=cli&tag=a&tag=b`);
            const follow = await server.fetch(new Request(new URL(response.headers.get('location') as string, origin)));
            expect(follow.status).toBe(200);
            expect(follow.headers.get('location')).toBeNull();
          });
        }
    it(`keeps unknown language fallback on ${origin}`, async () => {
      const response = await server.fetch(new Request(`${origin}/guide?lang=unknown`));
      expect(response.status).toBe(200);
      expect(response.headers.get('location')).toBeNull();
    });
    for (const path of ['//evil.com', '/%2F%2Fevil.com', '/%5C%5Cevil.com', '/%252f%252fevil.com', '/a%5cb']) {
      it(`cannot change origin with ${path} on ${origin}`, async () => {
        const response = await server.fetch(new Request(`${origin}${path}?lang=ar`));
        const location = response.headers.get('location');
        if (location) expect(new URL(location, origin).origin).toBe(new URL(origin).origin);
      });
    }
  }
  it.each([
    ['http://localhost:4310/sites/language-paths-014.md?lang=ar', '/sites/language-paths-014/ar.md'],
    ['http://localhost:4310/sites/language-paths-014.md?lang=en', '/sites/language-paths-014.md'],
    ['https://docs-language-paths.example/_index.md?lang=ar', '/ar.md'],
    ['https://docs-language-paths.example/_index.md?lang=en', '/_index.md'],
  ])('preserves the Markdown representation of a root migration: %s', async (url, target) => {
    const response = await server.fetch(new Request(url));
    expect(response.status).toBe(308);
    expect(response.headers.get('location')).toBe(target);
    const follow = await server.fetch(new Request(new URL(target, url)));
    expect(follow.status).toBe(200);
    expect(follow.headers.get('content-type')).toContain('text/markdown');
  });
  it('keeps binary OG language queries at their existing API endpoint', async () => {
    mocks.got.mockImplementation(async (target: string) => {
      if (target.includes('/og/')) return upstream(Buffer.from('png'));
      return upstream({
        data: {
          project: { config: { visibility: 'public' }, primaryDomain: null },
          languages: [
            { code: 'en', isDefault: true },
            { code: 'ar', isDefault: false },
          ],
        },
      });
    });
    const response = await server.fetch(new Request('http://localhost:4310/sites/language-paths-014/og/guide.png?lang=ar'));
    expect(response.status).toBe(200);
    expect(response.headers.get('location')).toBeNull();
    expect(response.headers.get('content-type')).toBe('image/png');
  });
  it('serves the localized changelog RSS alias without falling into the page router', async () => {
    mocks.got.mockImplementation(async (target: string) => {
      if (target.includes('/domains/resolve?')) return upstream({ data: { projectId: 'language-paths-014' } });
      if (target.endsWith('/changelog/rss.xml')) return upstream('<rss>http://localhost:4310/sites/language-paths-014/changelog#release-v1</rss>');
      return upstream({
        data: {
          project: { config: { visibility: 'public' }, primaryDomain: null },
          languages: [
            { code: 'en', isDefault: true },
            { code: 'ar', isDefault: false },
          ],
        },
      });
    });
    const response = await server.fetch(new Request('https://docs-language-paths.example/ar/changelog/rss.xml'));
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('application/rss+xml');
    expect(await response.text()).toContain('https://docs-language-paths.example/ar/changelog#release-v1');
    expect(mocks.startHandler).not.toHaveBeenCalled();
  });
  it('strips the prefix only for the Markdown API lookup and keeps discovery prefixed', async () => {
    const response = await server.fetch(new Request('https://docs-language-paths.example/ar/v2/guide.md'));
    expect(response.status).toBe(200);
    const call = mocks.got.mock.calls.find(([target]) => String(target).includes('/markdown?'));
    expect(String(call?.[0])).toContain('path=v2%2Fguide&lang=ar&version=v2');
    expect(response.headers.get('link')).toContain('https://docs-language-paths.example/ar/v2/guide.md');
  });
});
