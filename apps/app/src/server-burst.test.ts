import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ got: vi.fn(), startHandler: vi.fn() }));
vi.mock('@tanstack/react-start/server', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tanstack/react-start/server')>()),
  createStartHandler: () => mocks.startHandler,
  defaultStreamHandler: vi.fn(),
}));
vi.mock('got', () => ({ default: mocks.got }));
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
const metadata = (primaryDomain: string | null = null, visibility = 'public') =>
  upstream({ data: { project: { config: { visibility }, primaryDomain } } });
const request = (project: string, headers: Record<string, string> = {}) =>
  new Request(`http://localhost:4310/sites/${project}/intro`, { headers: { accept: 'text/html', ...headers } });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.startHandler.mockImplementation(
    async () => new Response('<!doctype html><title>Published</title>', { headers: { 'content-type': 'text/html' } }),
  );
});

describe('published metadata during reader bursts', () => {
  it('shares one anonymous metadata request across 25 concurrent cold readers', async () => {
    const project = 'burst-anonymous-qa';
    let complete!: (response: ReturnType<typeof upstream>) => void;
    const pending = new Promise<ReturnType<typeof upstream>>((resolve) => {
      complete = resolve;
    });
    mocks.got.mockImplementation((url: string) => {
      if (url.endsWith(`/api/public/sites/${project}`)) return pending;
      if (url.includes('/markdown?')) return Promise.resolve(upstream('# Introduction'));
      throw new Error(`Unexpected URL: ${url}`);
    });
    const readers = Array.from({ length: 25 }, () => server.fetch(request(project)));
    try {
      await vi.waitFor(() => expect(mocks.got.mock.calls.some(([url]) => String(url).endsWith(`/api/public/sites/${project}`))).toBe(true));
      expect(mocks.got.mock.calls.filter(([url]) => String(url).endsWith(`/api/public/sites/${project}`))).toHaveLength(1);
    } finally {
      complete(metadata());
      const responses = await Promise.all(readers);
      expect(responses.every((response) => response.status === 200)).toBe(true);
    }
  });

  it.each(['cookie', 'authorization'])('keeps concurrent %s metadata requests separate', async (header) => {
    const project = `burst-private-${header}`;
    mocks.got.mockImplementation(async (_url: string, options: { headers: Record<string, string> }) => {
      const value = options.headers[header];
      return metadata(value?.includes('one') ? 'one.example' : 'two.example', 'private');
    });
    const responses = await Promise.all(['one', 'two'].map((viewer) => server.fetch(request(project, { [header]: viewer }))));
    expect(responses.map((response) => response.headers.get('location'))).toEqual(['https://one.example/intro', 'https://two.example/intro']);
    expect(mocks.got).toHaveBeenCalledTimes(2);
  });

  it('retries metadata after an upstream failure instead of retaining the failed request', async () => {
    const project = 'burst-retry-qa';
    let available = false;
    mocks.got.mockImplementation(async (url: string) => {
      if (url.endsWith(`/api/public/sites/${project}`)) {
        if (!available) throw new Error('API unavailable');
        return metadata('recovered.example');
      }
      if (url.includes('/markdown?')) return upstream('# Introduction');
      throw new Error(`Unexpected URL: ${url}`);
    });
    const failed = await server.fetch(request(project));
    expect(failed.status).toBe(200);
    expect(failed.headers.get('location')).toBeNull();
    available = true;
    const recovered = await server.fetch(request(project));
    expect(recovered.status).toBe(301);
    expect(recovered.headers.get('location')).toBe('https://recovered.example/intro');
  });
});
