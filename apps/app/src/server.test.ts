import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  got: vi.fn(),
  startHandler: vi.fn(async () => new Response('<!doctype html><title>Published</title>', { headers: { 'content-type': 'text/html' } })),
}));

vi.mock('@tanstack/react-start/server', () => ({
  createStartHandler: () => mocks.startHandler,
  defaultStreamHandler: vi.fn(),
}));
vi.mock('got', () => ({ default: mocks.got }));
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

    expect(response.status).toBe(404);
    expect(response.headers.get('x-robots-tag')).toBe('noindex, nofollow');
    expect(mocks.got.mock.calls.some(([url]) => String(url).includes('/markdown?'))).toBe(false);
  });
});
