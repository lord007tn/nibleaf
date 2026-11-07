import { Hono } from 'hono';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  ensureBucket: vi.fn(),
  configureUploadCors: vi.fn(),
  schedule: vi.fn(),
  warn: vi.fn(),
  debug: vi.fn(),
  autoCors: true,
  requiredForHealth: false,
  close: vi.fn((callback: (error?: Error) => void) => callback()),
}));
vi.mock('@hono/node-server', () => ({ serve: () => ({ close: mocks.close }) }));
vi.mock('@nibleaf/bullmq', () => ({ scheduleAnalyticsRollup: mocks.schedule, closeQueues: vi.fn() }));
vi.mock('@nibleaf/clickhouse', () => ({ initializeClickHouseFn: vi.fn(), getAnalyticsHealth: vi.fn(), closeClickHouseClients: vi.fn() }));
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
  vi.useRealTimers();
  vi.restoreAllMocks();
});

async function boot() {
  await import('./index');
  await vi.advanceTimersByTimeAsync(0);
  return (await import('./routes')).default;
}

describe('storage bootstrap readiness', () => {
  it.each([{ $metadata: { httpStatusCode: 403 } }, { name: 'AccessDenied' }, { code: 'AccessDenied' }])(
    'stops permission-denied bootstrap calls without blocking default health (%j)',
    async (denial) => {
      mocks.ensureBucket.mockRejectedValue(Object.assign(new Error('bucket permission denied'), denial));
      mocks.configureUploadCors.mockRejectedValue(Object.assign(new Error('CORS permission denied'), { name: 'Forbidden' }));
      const app = await boot();
      const response = await app.request('/health');
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ status: 'ok', storage: { ready: false, cors: false, requiredForHealth: false } });
      await vi.advanceTimersByTimeAsync(600_000);
      expect(mocks.ensureBucket).toHaveBeenCalledTimes(1);
      expect(mocks.configureUploadCors).toHaveBeenCalledTimes(1);
      expect(mocks.warn).toHaveBeenCalledTimes(2);
      expect(mocks.debug).not.toHaveBeenCalled();
      expect(mocks.warn).toHaveBeenCalledWith(expect.objectContaining({ stopped: true }), expect.stringContaining('CORS does not gate API health'));
    },
  );

  it('stops a later permission failure and logs only the initial failure as a warning', async () => {
    mocks.ensureBucket
      .mockRejectedValueOnce(new Error('temporary failure'))
      .mockRejectedValue(Object.assign(new Error('permission changed'), { name: 'AccessDenied' }));
    const app = await boot();
    await vi.advanceTimersByTimeAsync(600_000);
    expect(mocks.ensureBucket).toHaveBeenCalledTimes(2);
    expect(mocks.warn).toHaveBeenCalledTimes(1);
    expect(mocks.debug).toHaveBeenCalledWith(expect.objectContaining({ attempt: 2, stopped: true }), expect.any(String));
    expect((await app.request('/health')).status).toBe(200);
  });

  it('gates health on the bucket only when explicitly required, and recovers despite CORS failure', async () => {
    mocks.requiredForHealth = true;
    mocks.ensureBucket.mockRejectedValueOnce(new Error('storage offline'));
    mocks.configureUploadCors.mockRejectedValue(new Error('CORS permission denied'));
    const app = await boot();
    expect((await app.request('/health')).status).toBe(503);
    await vi.advanceTimersByTimeAsync(999);
    expect(mocks.ensureBucket).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    const response = await app.request('/health');
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ storage: { ready: true, cors: false, requiredForHealth: true } });
    expect(mocks.ensureBucket).toHaveBeenCalledTimes(2);
  });

  it.each([false, true])('retries CORS independently without gating health (required=%s)', async (required) => {
    mocks.requiredForHealth = required;
    mocks.configureUploadCors.mockRejectedValueOnce(new Error('CORS temporarily unavailable'));
    const app = await boot();
    const pending = await app.request('/health');
    expect(pending.status).toBe(200);
    expect(await pending.json()).toMatchObject({ storage: { ready: true, cors: false } });
    await vi.advanceTimersByTimeAsync(1000);
    const recovered = await app.request('/health');
    expect(recovered.status).toBe(200);
    expect(await recovered.json()).toMatchObject({ storage: { ready: true, cors: true } });
    expect(mocks.configureUploadCors).toHaveBeenLastCalledWith(['https://docs.example.test']);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(mocks.ensureBucket).toHaveBeenCalledTimes(1);
    expect(mocks.configureUploadCors).toHaveBeenCalledTimes(2);
  });

  it('reports externally managed CORS as disabled while retrying the optional bucket check', async () => {
    mocks.autoCors = false;
    mocks.ensureBucket.mockRejectedValueOnce(new Error('bucket unavailable'));
    const app = await boot();
    const response = await app.request('/health');
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ storage: { ready: false, cors: null } });
    await vi.advanceTimersByTimeAsync(1000);
    expect(await (await app.request('/health')).json()).toMatchObject({ storage: { ready: true, cors: null } });
    expect(mocks.configureUploadCors).not.toHaveBeenCalled();
  });

  it('stops bucket and CORS retries after five attempts with one warning per operation', async () => {
    mocks.ensureBucket.mockRejectedValue(new Error('storage offline'));
    mocks.configureUploadCors.mockRejectedValue(new Error('temporary CORS failure'));
    const app = await boot();
    for (const delay of [1000, 2000, 4000, 8000]) await vi.advanceTimersByTimeAsync(delay);
    expect(mocks.ensureBucket).toHaveBeenCalledTimes(5);
    expect(mocks.configureUploadCors).toHaveBeenCalledTimes(5);
    expect(mocks.warn).toHaveBeenCalledTimes(2);
    expect(mocks.debug).toHaveBeenCalledTimes(8);
    expect(mocks.debug).toHaveBeenCalledWith(expect.objectContaining({ attempt: 5, stopped: true, retryMs: null }), expect.any(String));
    await vi.advanceTimersByTimeAsync(600_000);
    expect(mocks.ensureBucket).toHaveBeenCalledTimes(5);
    expect(mocks.configureUploadCors).toHaveBeenCalledTimes(5);
    expect((await app.request('/health')).status).toBe(200);
  });

  it('cancels pending reconciliation when shutting down', async () => {
    mocks.ensureBucket.mockRejectedValue(new Error('storage offline'));
    const app = await boot();
    await vi.advanceTimersByTimeAsync(1000);
    expect(mocks.ensureBucket).toHaveBeenCalledTimes(2);
    const shutdown = listenersOf('SIGTERM').find((listener) => !previousListeners.get('SIGTERM')?.includes(listener));
    shutdown?.('SIGTERM');
    await vi.advanceTimersByTimeAsync(60_000);
    expect(mocks.ensureBucket).toHaveBeenCalledTimes(2);
    expect((await app.request('/health')).status).toBe(503);
  });
});
