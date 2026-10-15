import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  server: true,
  port: 4310,
  nitroPort: undefined as number | undefined,
  locale: 'ar',
  auth: vi.fn(() => ({ signIn: vi.fn(), useSession: vi.fn() })),
}));

// Vitest does not run the Start compiler. Select its server/client branch here;
// production compilation strips the opposite implementation and its imports.
vi.mock('@tanstack/react-start', () => ({
  createIsomorphicFn: () => ({
    server: (server: () => string) => ({ client: (client: () => string) => () => (mocks.server ? server() : client()) }),
  }),
}));
vi.mock('@/env.server', () => ({
  serverEnv: {
    get PORT() {
      return mocks.port;
    },
    get NITRO_PORT() {
      return mocks.nitroPort;
    },
  },
}));
vi.mock('@/env', () => ({ env: { VITE_APP_URL: 'https://public-dashboard.example:4410' } }));
vi.mock('@nibleaf/i18n/runtime', () => ({ getLocale: () => mocks.locale }));
vi.mock('@nibleaf/auth/client', () => ({ createNibleafAuthClientFn: mocks.auth }));
vi.mock('@nibleaf/server/rpc', async () => ({ hcWithType: (await import('hono/client')).hc }));

describe('app API transport origins', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    mocks.server = true;
    mocks.port = 4310;
    mocks.nitroPort = undefined;
    mocks.locale = 'ar';
  });
  afterEach(() => vi.unstubAllGlobals());

  it.each([
    [4310, undefined],
    [5510, undefined],
    [4310, 5511],
  ] as const)('SSR uses internal PORT %s / NITRO_PORT %s rather than the public mapped port', async (port, nitroPort) => {
    mocks.port = port;
    mocks.nitroPort = nitroPort;
    const internalPort = nitroPort ?? port;
    const transport = vi.fn<typeof fetch>(async () => Response.json({ data: {} }));
    vi.stubGlobal('fetch', transport);
    const { api } = await import('./api');
    await api.public.sites[':id'].page.$get({ param: { id: 'synthetic-site' }, query: { path: '/المقدمة', lang: 'ar', version: '2' } });
    const [input, init] = transport.mock.calls[0] as unknown as [string, RequestInit];
    const target = new URL(input);
    expect(target.origin).toBe(`http://localhost:${internalPort}`);
    expect(target.pathname).toBe('/api/public/sites/synthetic-site/page');
    expect(Object.fromEntries(target.searchParams)).toEqual({ path: '/المقدمة', lang: 'ar', version: '2' });
    expect(init.credentials).toBe('include');
    expect(new Headers(init.headers).get('x-nibleaf-locale')).toBe('ar');
    await import('./auth-client');
    expect(mocks.auth).toHaveBeenCalledWith({ baseURL: `http://localhost:${internalPort}`, locale: expect.any(Function) });
  });

  it.each(['http://localhost:4410', 'https://docs.customer.example'])('browser RPC and auth stay on current origin %s', async (origin) => {
    mocks.server = false;
    vi.stubGlobal('window', { location: { origin } });
    const transport = vi.fn<typeof fetch>(async () => Response.json({ data: {} }));
    vi.stubGlobal('fetch', transport);
    const { api } = await import('./api');
    await api.public.sites[':id'].$get({ param: { id: 'synthetic-site' }, query: { lang: 'ar' } });
    expect(String(transport.mock.calls[0]?.[0])).toBe(`${origin}/api/public/sites/synthetic-site?lang=ar`);
    await import('./auth-client');
    expect(mocks.auth).toHaveBeenCalledWith({ baseURL: origin, locale: expect.any(Function) });
  });

  it('preserves explicit credentials and caller headers while stamping the current locale per request', async () => {
    const transport = vi.fn<typeof fetch>(async () => Response.json({ data: [] }));
    vi.stubGlobal('fetch', transport);
    const { api } = await import('./api');
    await api.app.projects.$get(undefined, {
      headers: { cookie: 'synthetic-session=one', authorization: 'Bearer synthetic-reader', 'x-request-id': 'synthetic-request' },
    });
    mocks.locale = 'en';
    await api.app.projects.$get();
    const first = new Headers((transport.mock.calls[0] as unknown as [string, RequestInit])[1].headers);
    const second = new Headers((transport.mock.calls[1] as unknown as [string, RequestInit])[1].headers);
    expect(first.get('cookie')).toBe('synthetic-session=one');
    expect(first.get('authorization')).toBe('Bearer synthetic-reader');
    expect(first.get('x-request-id')).toBe('synthetic-request');
    expect(first.get('x-nibleaf-locale')).toBe('ar');
    expect(second.get('x-nibleaf-locale')).toBe('en');
    expect(second.get('cookie')).toBeNull();
    expect(second.get('authorization')).toBeNull();
  });
});
