import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  port: 4310,
  nitroPort: undefined as number | undefined,
  fetch: vi.fn<typeof fetch>(async () => Response.json({ data: {} })),
  got: vi.fn(),
  startHandler: vi.fn<(request: Request) => Promise<Response>>(),
}));

vi.mock('@tanstack/react-start/server', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tanstack/react-start/server')>()),
  createStartHandler: () => mocks.startHandler,
  defaultStreamHandler: vi.fn(),
}));
vi.mock('@nibleaf/i18n', () => ({ translateFn: () => 'synthetic translation' }));
vi.mock('@nibleaf/i18n/runtime', () => ({ getLocale: () => 'ar' }));
vi.mock('@nibleaf/server/rpc', async () => ({ hcWithType: (await import('hono/client')).hc }));
vi.mock('got', () => ({ default: mocks.got }));
// Marketing article modules are unrelated to reader credential forwarding and
// otherwise make each isolated server-entry import compile every translation.
vi.mock('@/lib/blog', () => ({ BLOG_ENTRIES: [] }));
vi.mock('@/env.server', () => ({
  serverEnv: {
    APP_URL: 'http://public-dashboard.example:4410',
    get PORT() {
      return mocks.port;
    },
    get NITRO_PORT() {
      return mocks.nitroPort;
    },
    TRUSTED_PROXY_HOPS: 0,
    INTERNAL_API_SECRET: 'synthetic-internal-secret',
    CUSTOM_DOMAIN_EDGE_SECRET: '',
  },
}));

/** Import the server entry once per environment: `api` and `server` read
 *  PORT / NITRO_PORT and patch the global fetch while their modules evaluate,
 *  so a configuration needs its own module graph. Evaluating it is CPU-bound
 *  (#330), so it happens here, outside the per-test timeout, and each test
 *  measures only the request path. */
const serverFor = (port: number, nitroPort: number | undefined) => {
  const loaded = {} as { api: typeof import('./api')['api']; server: typeof import('../server')['default'] };
  beforeAll(async () => {
    vi.resetModules();
    mocks.port = port;
    mocks.nitroPort = nitroPort;
    vi.stubGlobal('fetch', mocks.fetch);
    loaded.api = (await import('./api')).api;
    loaded.server = (await import('../server')).default;
  }, 120_000);
  afterAll(() => vi.unstubAllGlobals());
  return loaded;
};

describe('SSR RPC request context through the loopback proxy', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.fetch.mockResolvedValue(Response.json({ data: {} }));
    mocks.got.mockImplementation(async (url: string) => {
      const target = new URL(url);
      if (target.pathname === '/api/public/domains/resolve') return { ok: true, statusCode: 200, body: { data: { projectId: 'synthetic-site' } } };
      if (target.pathname === '/api/public/sites/synthetic-site')
        return { ok: true, statusCode: 200, body: { data: { project: { config: { visibility: 'private' }, primaryDomain: null } } } };
      return { ok: false, statusCode: 404, body: '', headers: {} };
    });
  });

  describe.each([
    [4310, undefined, 'http://public-dashboard.example:4410/sites/synthetic-site/المقدمة?lang=ar'],
    [5510, undefined, 'https://docs.synthetic.example/المقدمة?lang=ar'],
    [4310, 5511, 'https://docs.synthetic.example/المقدمة?lang=ar'],
  ] as const)('on PORT %s / NITRO_PORT %s', (port, nitroPort, url) => {
    const loaded = serverFor(port, nitroPort);

    it(`keeps reader auth, locale and visitor context for ${url}`, async () => {
      const { api, server } = loaded;
      let renderedRequest: Request | undefined;
      mocks.startHandler.mockImplementation(async (request) => {
        renderedRequest = request;
        await api.public.sites[':id'].page.$get({ param: { id: 'synthetic-site' }, query: { lang: 'ar', path: '/المقدمة' } });
        return new Response('<!doctype html><title>Reader</title>', { headers: { 'content-type': 'text/html' } });
      });
      const response = await server.fetch(
        new Request(url, {
          headers: {
            accept: 'text/html',
            cookie: 'synthetic-session=reader',
            authorization: 'Bearer synthetic-reader',
            'x-forwarded-for': '203.0.113.42',
            'x-private-unrelated': 'must-not-forward',
          },
        }),
      );
      expect(response.status).toBe(200);
      expect(response.headers.get('cache-control')).toContain('private');
      const [input, init] = mocks.fetch.mock.calls[0] ?? [];
      const target = new URL(String(input));
      expect(target.origin).toBe(`http://localhost:${nitroPort ?? port}`);
      expect(target.pathname).toBe('/api/public/sites/synthetic-site/page');
      expect(target.searchParams.get('lang')).toBe('ar');
      expect(target.searchParams.get('path')).toBe('/المقدمة');
      const headers = new Headers(init?.headers);
      expect(headers.get('cookie')).toBe('synthetic-session=reader');
      expect(headers.get('authorization')).toBe('Bearer synthetic-reader');
      expect(headers.get('x-nibleaf-client-ip')).toBe('203.0.113.42');
      expect(headers.get('x-nibleaf-internal')).toBe('synthetic-internal-secret');
      expect(headers.get('x-nibleaf-locale')).toBe('ar');
      expect(headers.get('x-private-unrelated')).toBeNull();
      if (url.startsWith('https://docs.')) {
        expect(renderedRequest?.headers.get('x-nibleaf-site-origin')).toBe('https://docs.synthetic.example');
        expect(new URL(renderedRequest?.url ?? '').pathname).toContain('/sites/synthetic-site/');
      }

      mocks.fetch.mockClear();
      await server.fetch(new Request(url, { headers: { accept: 'text/html' } }));
      const anonymous = new Headers(mocks.fetch.mock.calls[0]?.[1]?.headers);
      expect(anonymous.get('cookie')).toBeNull();
      expect(anonymous.get('authorization')).toBeNull();
      expect(anonymous.get('x-nibleaf-internal')).toBeNull();
    });
  });

  describe('a client-sent site origin', () => {
    const loaded = serverFor(4310, undefined);

    it.each([
      ['http://public-dashboard.example:4410/sites/synthetic-site/intro', null],
      ['https://docs.synthetic.example/intro', 'https://docs.synthetic.example'],
    ] as const)('is ignored on %s', async (url, expected) => {
      const { server } = loaded;
      let renderedRequest: Request | undefined;
      mocks.startHandler.mockImplementation(async (request) => {
        renderedRequest = request;
        return new Response('<!doctype html><title>Reader</title>', { headers: { 'content-type': 'text/html' } });
      });
      await server.fetch(new Request(url, { headers: { accept: 'text/html', 'x-nibleaf-site-origin': 'https://spoofed.example' } }));
      expect(renderedRequest).toBeDefined();
      expect(renderedRequest?.headers.get('x-nibleaf-site-origin')).toBe(expected);
    });
  });
});
