import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  server: true,
  port: 4315,
  nitroPort: undefined as number | undefined,
  auth: vi.fn(() => ({ signOut: vi.fn(), useSession: vi.fn() })),
}));

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
vi.mock('@/lib/links', () => ({ APP_URL: 'https://public-dashboard.example:4410' }));
vi.mock('@nibleaf/i18n', () => ({ getLocale: () => 'ar', REQUEST_LOCALE_HEADER: 'x-nibleaf-locale' }));
vi.mock('@nibleaf/auth/client', () => ({ createNibleafAuthClientFn: mocks.auth }));
vi.mock('@nibleaf/server/rpc', async () => ({ hcWithType: (await import('hono/client')).hc }));

describe('admin API transport origins', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    mocks.server = true;
    mocks.port = 4315;
    mocks.nitroPort = undefined;
  });
  afterEach(() => vi.unstubAllGlobals());

  it.each([
    [4315, undefined],
    [5515, undefined],
    [4315, 5516],
  ] as const)('SSR uses internal PORT %s / NITRO_PORT %s without changing /api or locale headers', async (port, nitroPort) => {
    mocks.port = port;
    mocks.nitroPort = nitroPort;
    const internalPort = nitroPort ?? port;
    const transport = vi.fn<typeof fetch>(async () => Response.json({ data: {} }));
    vi.stubGlobal('fetch', transport);
    const { api } = await import('./api');
    await api.admin.overview.$get();
    const [input, init] = transport.mock.calls[0] as unknown as [string, RequestInit];
    expect(input).toBe(`http://localhost:${internalPort}/api/admin/overview`);
    expect(init.credentials).toBe('include');
    expect(new Headers(init.headers).get('x-nibleaf-locale')).toBe('ar');
    await import('./auth-client');
    expect(mocks.auth).toHaveBeenCalledWith({ baseURL: `http://localhost:${internalPort}`, locale: expect.any(Function) });
  });

  it('browser RPC and auth retain the app origin so impersonation sessions are created on that origin', async () => {
    mocks.server = false;
    vi.stubGlobal('window', { location: { origin: 'https://admin-dashboard.example:4415' } });
    const transport = vi.fn<typeof fetch>(async () => Response.json({ data: {} }));
    vi.stubGlobal('fetch', transport);
    const { api } = await import('./api');
    await api.admin.overview.$get(undefined, { headers: { authorization: 'Bearer synthetic-admin' } });
    const [input, init] = transport.mock.calls[0] as unknown as [string, RequestInit];
    expect(input).toBe('https://public-dashboard.example:4410/api/admin/overview');
    expect(new Headers(init.headers).get('authorization')).toBe('Bearer synthetic-admin');
    expect(init.credentials).toBe('include');
    await import('./auth-client');
    expect(mocks.auth).toHaveBeenCalledWith({ baseURL: 'https://public-dashboard.example:4410', locale: expect.any(Function) });
  });
});
