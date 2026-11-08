import { Hono } from 'hono';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  ensureBucket: vi.fn(),
  configureUploadCors: vi.fn(),
  schedule: vi.fn(),
  analytics: vi.fn(),
  warn: vi.fn(),
  debug: vi.fn(),
  autoCors: true,
  requiredForHealth: false,
  close: vi.fn((callback: (error?: Error) => void) => callback()),
}));
vi.mock('@hono/node-server', () => ({ serve: () => ({ close: mocks.close }) }));
vi.mock('@nibleaf/bullmq', () => ({ scheduleAnalyticsRollup: mocks.schedule, closeQueues: vi.fn() }));
vi.mock('@nibleaf/clickhouse', () => ({ initializeClickHouseFn: vi.fn(), getAnalyticsHealth: mocks.analytics, closeClickHouseClients: vi.fn() }));
vi.mock('@nibleaf/storage', () => ({ ensureBucket: mocks.ensureBucket, configureUploadCors: mocks.configureUploadCors }));
vi.mock('@nibleaf/logger', () => ({ logger: { info: vi.fn(), warn: mocks.warn, debug: mocks.debug, error: vi.fn() } }));
vi.mock('./env', () => ({
  env: {
    API_PORT: 4311,
    API_URL: 'http://api.example.test',
    get STORAGE_AUTO_CORS() {
      return mocks.autoCors;
    },
    get STORAGE_REQUIRED_FOR_HEALTH() {
      return mocks.requiredForHealth;
    },
    STORAGE_CORS_ALLOWED_ORIGINS: ['https://docs.example.test'],
  },
}));
vi.mock('./lib/ai-search/chat-budget', () => ({ chatBudgetWarning: vi.fn() }));

const events = ['SIGTERM', 'SIGINT', 'unhandledRejection', 'uncaughtException'] as const;
type Listener = (...args: unknown[]) => void;
// process.listeners() is overloaded per event name; read them through one signature.
const listenersOf = (event: (typeof events)[number]) => (process.listeners as (name: string) => Listener[])(event);
let previousListeners: Map<(typeof events)[number], Listener[]>;

beforeEach(() => {
  vi.resetModules();
  vi.doMock('./routes', () => ({ default: new Hono() }));
  vi.useFakeTimers();
  vi.clearAllMocks();
  vi.stubEnv('INTERNAL_API_SECRET', 'synthetic-health-secret');
  vi.stubEnv('NIBLEAF_REVISION', 'synthetic-revision');
  mocks.analytics.mockResolvedValue({ configured: true, provider: 'internal-provider', endpoint: 'https://internal.example.test' });
  mocks.autoCors = true;
  mocks.requiredForHealth = false;
  mocks.ensureBucket.mockReset().mockResolvedValue(undefined);
  mocks.configureUploadCors.mockReset().mockResolvedValue(undefined);
  mocks.schedule.mockResolvedValue(undefined);
  previousListeners = new Map(events.map((event) => [event, listenersOf(event)]));
  vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
});
afterEach(() => {
  for (const event of events) {
    for (const listener of listenersOf(event)) {
      if (!previousListeners.get(event)?.includes(listener)) process.removeListener(event, listener);
    }
  }
  vi.unstubAllEnvs();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

async function boot() {
  await import('./index');
  await vi.advanceTimersByTimeAsync(0);
  return (await import('./routes')).default;
}

const internalHeaders = { 'x-nibleaf-internal': 'synthetic-health-secret' };
const details = (app: Awaited<ReturnType<typeof boot>>) => app.request('/health/details', { headers: internalHeaders });

describe('public and internal health contracts', () => {
  it('advertises the package build version in OpenAPI', async () => {
    const app = await boot();
    const { version } = await import('../package.json');
    const response = await app.request('/openapi.json');
    expect(await response.json()).toMatchObject({ info: { version } });
  });
  it('publishes only status and the existing revision, without invoking detailed diagnostics', async () => {
    mocks.ensureBucket.mockRejectedValue(new Error('private bucket at internal.example.test'));
    mocks.configureUploadCors.mockRejectedValue(new Error('private provider details'));
    const app = await boot();
    const response = await app.request('/health');
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: 'ok', revision: 'synthetic-revision' });
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(mocks.analytics).not.toHaveBeenCalled();
    expect(mocks.debug).toHaveBeenCalledWith(
      expect.objectContaining({ storage: expect.objectContaining({ ready: false, cors: false }) }),
      'Storage bootstrap status',
    );
  });

  it.each([undefined, 'wrong-secret', 'synthetic-health-secreu', 'synthetic-health-secret-extra'])(
    'rejects detailed health without the exact internal proof (%s)',
    async (proof) => {
      const app = await boot();
      const response = await app.request('/health/details', { headers: proof ? { 'x-nibleaf-internal': proof } : {} });
      expect(response.status).toBe(401);
      expect(await response.json()).toEqual({ status: 'unauthorized' });
      expect(response.headers.get('cache-control')).toBe('private, no-store');
      expect(mocks.analytics).not.toHaveBeenCalled();
    },
  );

  it.each([undefined, ''])('disables detailed health when INTERNAL_API_SECRET is unset (%s)', async (secret) => {
    vi.stubEnv('INTERNAL_API_SECRET', secret);
    const app = await boot();
    expect((await details(app)).status).toBe(401);
    expect((await app.request('/health')).status).toBe(200);
    expect(mocks.analytics).not.toHaveBeenCalled();
  });

  it('returns storage and analytics details only with the configured internal secret', async () => {
    const app = await boot();
    const response = await details(app);
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(await response.json()).toMatchObject({
      status: 'ok',
      revision: 'synthetic-revision',
      analytics: { configured: true },
      storage: { ready: true, cors: true, requiredForHealth: false },
    });
    expect(mocks.analytics).toHaveBeenCalledTimes(1);
  });
});

describe('storage bootstrap readiness', () => {
  it.each([
    { $metadata: { httpStatusCode: 401 } },
    { $metadata: { httpStatusCode: 403 } },
    { name: 'AccessDenied' },
    { code: 'AccessDenied' },
    { name: 'InvalidAccessKeyId' },
    { code: 'InvalidAccessKeyId' },
  ])('stops rejected credentials without blocking default health (%j)', async (denial) => {
    mocks.ensureBucket.mockRejectedValue(Object.assign(new Error('bucket credentials rejected'), denial));
    mocks.configureUploadCors.mockRejectedValue(Object.assign(new Error('CORS permission denied'), { name: 'Forbidden' }));
    const app = await boot();
    expect((await app.request('/health')).status).toBe(200);
    expect(await (await details(app)).json()).toMatchObject({ storage: { ready: false, cors: false, requiredForHealth: false } });
    await vi.advanceTimersByTimeAsync(600_000);
    expect(mocks.ensureBucket).toHaveBeenCalledTimes(1);
    expect(mocks.configureUploadCors).toHaveBeenCalledTimes(1);
    expect(mocks.warn).toHaveBeenCalledTimes(2);
    expect(mocks.warn).toHaveBeenCalledWith(
      expect.objectContaining({ stopped: true }),
      expect.stringContaining('fix rejected storage credentials or bucket permissions'),
    );
    expect(mocks.warn).toHaveBeenCalledWith(expect.objectContaining({ stopped: true }), expect.stringContaining('CORS does not gate API health'));
  });

  it('warns visibly when a later failure finally stops bucket and CORS bootstrap', async () => {
    mocks.ensureBucket
      .mockRejectedValueOnce(new Error('temporary failure'))
      .mockRejectedValue(Object.assign(new Error('permission changed'), { name: 'AccessDenied' }));
    mocks.configureUploadCors
      .mockRejectedValueOnce(new Error('temporary failure'))
      .mockRejectedValue(Object.assign(new Error('invalid key'), { name: 'InvalidAccessKeyId' }));
    const app = await boot();
    await vi.advanceTimersByTimeAsync(600_000);
    expect(mocks.ensureBucket).toHaveBeenCalledTimes(2);
    expect(mocks.configureUploadCors).toHaveBeenCalledTimes(2);
    expect(mocks.warn).toHaveBeenCalledTimes(4);
    expect(mocks.warn).toHaveBeenCalledWith(expect.objectContaining({ attempt: 2, stopped: true }), expect.stringContaining('bootstrap stopped'));
    expect((await app.request('/health')).status).toBe(200);
  });

  it('gates health on the bucket only when explicitly required, despite CORS failure', async () => {
    mocks.requiredForHealth = true;
    mocks.ensureBucket.mockRejectedValueOnce(new Error('storage offline'));
    mocks.configureUploadCors.mockRejectedValue(Object.assign(new Error('CORS permission denied'), { name: 'AccessDenied' }));
    const app = await boot();
    expect((await app.request('/health')).status).toBe(503);
    await vi.advanceTimersByTimeAsync(1000);
    const response = await app.request('/health');
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: 'ok', revision: 'synthetic-revision' });
    expect(await (await details(app)).json()).toMatchObject({ storage: { ready: true, cors: false, requiredForHealth: true } });
  });

  it.each([false, true])('retries transient CORS failures independently (required=%s)', async (required) => {
    mocks.requiredForHealth = required;
    mocks.configureUploadCors.mockRejectedValueOnce(new Error('CORS temporarily unavailable'));
    const app = await boot();
    expect((await app.request('/health')).status).toBe(200);
    expect(await (await details(app)).json()).toMatchObject({ storage: { ready: true, cors: false } });
    await vi.advanceTimersByTimeAsync(1000);
    expect(await (await details(app)).json()).toMatchObject({ storage: { ready: true, cors: true } });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(mocks.ensureBucket).toHaveBeenCalledTimes(1);
    expect(mocks.configureUploadCors).toHaveBeenCalledTimes(2);
  });

  it('reports externally managed CORS internally while retrying the optional bucket check', async () => {
    mocks.autoCors = false;
    mocks.ensureBucket.mockRejectedValueOnce(new Error('bucket unavailable'));
    const app = await boot();
    expect((await app.request('/health')).status).toBe(200);
    expect(await (await details(app)).json()).toMatchObject({ storage: { ready: false, cors: null } });
    await vi.advanceTimersByTimeAsync(1000);
    expect(await (await details(app)).json()).toMatchObject({ storage: { ready: true, cors: null } });
    expect(mocks.configureUploadCors).not.toHaveBeenCalled();
  });

  it.each([{ code: 'ECONNREFUSED' }, { $metadata: { httpStatusCode: 503 } }])(
    'recovers required health and CORS after five transient failures (%j)',
    async (failure) => {
      mocks.requiredForHealth = true;
      for (let attempt = 0; attempt < 5; attempt++) {
        mocks.ensureBucket.mockRejectedValueOnce(Object.assign(new Error('temporary bucket outage'), failure));
        mocks.configureUploadCors.mockRejectedValueOnce(Object.assign(new Error('temporary CORS outage'), failure));
      }
      const app = await boot();
      for (const delay of [1000, 2000, 4000, 8000]) await vi.advanceTimersByTimeAsync(delay);
      expect(mocks.ensureBucket).toHaveBeenCalledTimes(5);
      expect(mocks.configureUploadCors).toHaveBeenCalledTimes(5);
      const pending = await app.request('/health');
      expect(pending.status).toBe(503);
      expect(await pending.json()).toEqual({ status: 'starting', revision: 'synthetic-revision' });
      await vi.advanceTimersByTimeAsync(16_000);
      expect(mocks.ensureBucket).toHaveBeenCalledTimes(6);
      expect(mocks.configureUploadCors).toHaveBeenCalledTimes(6);
      expect((await app.request('/health')).status).toBe(200);
      expect(await (await details(app)).json()).toMatchObject({ storage: { ready: true, cors: true, requiredForHealth: true } });
      expect(mocks.warn).toHaveBeenCalledTimes(2);
      expect(mocks.debug).toHaveBeenCalledWith(expect.objectContaining({ attempt: 5, stopped: false }), expect.any(String));
      await vi.advanceTimersByTimeAsync(600_000);
      expect(mocks.ensureBucket).toHaveBeenCalledTimes(6);
    },
  );

  it('continues transient retries at the 30-second cap with debug logs after the first warning', async () => {
    mocks.ensureBucket.mockRejectedValue(new Error('storage offline'));
    mocks.configureUploadCors.mockRejectedValue(new Error('temporary CORS failure'));
    const app = await boot();
    for (const delay of [1000, 2000, 4000, 8000, 16_000, 30_000, 30_000]) await vi.advanceTimersByTimeAsync(delay);
    expect(mocks.ensureBucket).toHaveBeenCalledTimes(8);
    await vi.advanceTimersByTimeAsync(29_999);
    expect(mocks.ensureBucket).toHaveBeenCalledTimes(8);
    await vi.advanceTimersByTimeAsync(1);
    expect(mocks.ensureBucket).toHaveBeenCalledTimes(9);
    expect(mocks.configureUploadCors).toHaveBeenCalledTimes(9);
    expect(mocks.warn).toHaveBeenCalledTimes(2);
    expect(mocks.debug).toHaveBeenCalledWith(expect.objectContaining({ attempt: 9, retryMs: 30_000, stopped: false }), expect.any(String));
    expect((await app.request('/health')).status).toBe(200);
  });

  it.each(['NoSuchBucket', 'InvalidBucketName', 'PermanentRedirect'])(
    'keeps repeated configuration failures visible every tenth attempt (%s)',
    async (name) => {
      mocks.ensureBucket.mockRejectedValue(Object.assign(new Error('bucket configuration failure'), { name }));
      mocks.configureUploadCors.mockRejectedValue(Object.assign(new Error('CORS configuration failure'), { name }));
      const app = await boot();
      for (const delay of [1000, 2000, 4000, 8000, 16_000, 30_000, 30_000, 30_000]) await vi.advanceTimersByTimeAsync(delay);
      expect(mocks.ensureBucket).toHaveBeenCalledTimes(9);
      expect(mocks.warn).toHaveBeenCalledTimes(2);
      await vi.advanceTimersByTimeAsync(30_000);
      expect(mocks.ensureBucket).toHaveBeenCalledTimes(10);
      expect(mocks.warn).toHaveBeenCalledTimes(4);
      expect(mocks.warn).toHaveBeenCalledWith(
        expect.objectContaining({ attempt: 10, retryMs: 30_000, stopped: false }),
        'Storage bucket check failed; retrying automatically',
      );
      expect(mocks.warn).toHaveBeenCalledWith(
        expect.objectContaining({ attempt: 10, retryMs: 30_000, stopped: false }),
        expect.stringContaining('Storage upload CORS setup failed'),
      );
      await vi.advanceTimersByTimeAsync(30_000);
      expect(mocks.warn).toHaveBeenCalledTimes(4);
      expect(mocks.debug).toHaveBeenCalledWith(expect.objectContaining({ attempt: 11, stopped: false }), expect.any(String));
      await vi.advanceTimersByTimeAsync(9 * 30_000);
      expect(mocks.ensureBucket).toHaveBeenCalledTimes(20);
      expect(mocks.configureUploadCors).toHaveBeenCalledTimes(20);
      expect(mocks.warn).toHaveBeenCalledTimes(6);
      expect(mocks.warn).toHaveBeenCalledWith(expect.objectContaining({ attempt: 20, stopped: false }), expect.any(String));
      expect((await app.request('/health')).status).toBe(200);
    },
  );

  it('cancels pending reconciliation when shutting down', async () => {
    mocks.ensureBucket.mockRejectedValue(new Error('storage offline'));
    const app = await boot();
    await vi.advanceTimersByTimeAsync(1000);
    const shutdown = listenersOf('SIGTERM').find((listener) => !previousListeners.get('SIGTERM')?.includes(listener));
    shutdown?.('SIGTERM');
    await vi.advanceTimersByTimeAsync(60_000);
    expect(mocks.ensureBucket).toHaveBeenCalledTimes(2);
    expect((await app.request('/health')).status).toBe(503);
  });
});
