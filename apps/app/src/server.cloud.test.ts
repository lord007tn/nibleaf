import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SITE_MARKDOWN_ALTERNATE_HEADER } from '@/lib/site-seo';

const mocks = vi.hoisted(() => ({ got: vi.fn(), startHandler: vi.fn() }));

vi.mock('@tanstack/react-start/server', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tanstack/react-start/server')>()),
  createStartHandler: () => mocks.startHandler,
  defaultStreamHandler: vi.fn(),
}));
vi.mock('got', () => ({ default: mocks.got }));
vi.mock('@nibleaf/i18n', () => ({ translateFn: () => 'synthetic translation' }));
vi.mock('@/lib/blog', () => ({ BLOG_ENTRIES: [] }));
// Nibleaf Cloud: the app origin is the marketing host, so published pages
// render through the marketing branch of the server entry.
vi.mock('@/env.server', () => ({
  serverEnv: { APP_URL: 'https://nibleaf.com', CUSTOM_DOMAIN_EDGE_SECRET: '', INTERNAL_API_SECRET: '', PORT: 4310, TRUSTED_PROXY_HOPS: 0 },
}));

import server from './server';

describe('published pages on the Cloud app origin', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.got.mockResolvedValue({
      body: { data: { project: { config: { visibility: 'public' }, primaryDomain: null } } },
      ok: true,
      statusCode: 200,
      headers: {},
    });
    mocks.startHandler.mockImplementation(
      async () => new Response('<!doctype html>', { headers: { 'content-type': 'text/html', [SITE_MARKDOWN_ALTERNATE_HEADER]: '1' } }),
    );
  });

  it('never leaks the internal Markdown flag', async () => {
    const response = await server.fetch(new Request('https://nibleaf.com/sites/project-1/guide', { headers: { accept: 'text/html' } }));

    expect(mocks.startHandler).toHaveBeenCalledOnce();
    expect(response.status).toBe(200);
    expect(response.headers.get(SITE_MARKDOWN_ALTERNATE_HEADER)).toBeNull();
  });
});
