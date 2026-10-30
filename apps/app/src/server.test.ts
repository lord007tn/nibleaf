import { appendResponseHeader, getRequest, getRequestHeader, setCookie, setResponseHeader, setResponseStatus } from '@tanstack/react-start/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SitePage } from '@/hooks/api/types';
import { pageHead } from '@/lib/site-seo';

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

import server from './server';

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
        return upstream({ data: { project: { config: { visibility: 'public' }, primaryDomain: null } } });
      }
      if (url.includes('/api/public/sites/project-1/markdown?')) return upstream('# المقدمة\n');
      throw new Error(`Unexpected URL: ${url}`);
    });
  });

  it('decodes an Arabic pathname once before proxying and keeps its discovery URL singly encoded', async () => {
    const response = await server.fetch(
      new Request('http://localhost:4310/sites/project-1/%D8%A7%D9%84%D9%85%D9%82%D8%AF%D9%85%D8%A9?lang=ar', {
        headers: { accept: 'text/markdown' },
      }),
    );
    const markdownCall = mocks.got.mock.calls.find(([url]) => String(url).includes('/markdown?'));
    const proxiedUrl = new URL(String(markdownCall?.[0]));

    expect(response.status).toBe(200);
    expect(await response.text()).toBe('# المقدمة\n');
    expect(proxiedUrl.searchParams.get('path')).toBe('/المقدمة');
    expect(proxiedUrl.searchParams.get('lang')).toBe('ar');
    expect(response.headers.get('link')).toContain('/sites/project-1/%D8%A7%D9%84%D9%85%D9%82%D8%AF%D9%85%D8%A9.md?lang=ar');
    expect(response.headers.get('link')).not.toContain('%25D8');
  });

  it('keeps an index page distinct from the root Markdown alias', async () => {
    await server.fetch(new Request('https://docs-index-test.example/index.md', { headers: { accept: 'text/markdown' } }));
    await server.fetch(new Request('https://docs-index-test.example/_index.md', { headers: { accept: 'text/markdown' } }));

    const markdownCalls = mocks.got.mock.calls.filter(([url]) => String(url).includes('/markdown?'));
    expect(new URL(String(markdownCalls[0]?.[0])).searchParams.get('path')).toBe('/index');
    expect(new URL(String(markdownCalls[1]?.[0])).searchParams.get('path')).toBe('/');
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
        return new Response('<!doctype html><title>Guide</title>', { headers: { 'content-type': 'text/html' } });
      });
      const response = await server.fetch(
        new Request(`${origin}${path}`, { headers: { accept: 'text/html', 'x-nibleaf-site-origin': 'https://client-origin.example' } }),
      );
      expect(response.status).toBe(200);
      expect(response.headers.get('link')).toContain(`${origin}${path}.md`);
      expect(mocks.startHandler).toHaveBeenCalledOnce();
    },
  );

  it.each(['noindex page', 'language indexing disabled', 'external canonical', 'hidden page', 'private site'])(
    'omits HTML discovery when %s has no public Markdown response',
    async () => {
      mocks.got.mockImplementation(async (url: string) => {
        if (url.endsWith('/api/public/sites/project-1')) {
          return upstream({ data: { project: { config: { visibility: 'public' }, primaryDomain: null } } });
        }
        if (url.includes('/api/public/sites/project-1/markdown?')) return upstream('Not found', 404);
        throw new Error(`Unexpected URL: ${url}`);
      });

      const response = await server.fetch(new Request('http://localhost:4310/sites/project-1/authentication', { headers: { accept: 'text/html' } }));

      expect(response.status).toBe(200);
      expect(response.headers.get('link')).toBeNull();
    },
  );

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
