import { Hono } from 'hono';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  ensureBucket: vi.fn(),
  configureUploadCors: vi.fn(),
  schedule: vi.fn(),
  close: vi.fn((callback: (error?: Error) => void) => callback()),
}));
vi.mock('@hono/node-server', () => ({ serve: () => ({ close: mocks.close }) }));
vi.mock('@nibleaf/bullmq', () => ({ scheduleAnalyticsRollup: mocks.schedule, closeQueues: vi.fn() }));
vi.mock('@nibleaf/clickhouse', () => ({ initializeClickHouseFn: vi.fn(), getAnalyticsHealth: vi.fn(), closeClickHouseClients: vi.fn() }));
vi.mock('@nibleaf/storage', () => ({ ensureBucket: mocks.ensureBucket, configureUploadCors: mocks.configureUploadCors }));
vi.mock('@nibleaf/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('./env', () => ({
  env: { API_PORT: 4311, API_URL: 'http://api.example.test', STORAGE_AUTO_CORS: true, STORAGE_CORS_ALLOWED_ORIGINS: ['https://docs.example.test'] },
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
  it('keeps health unavailable through bucket and CORS failures, then recovers', async () => {
    mocks.ensureBucket.mockRejectedValueOnce(new Error('storage offline'));
    mocks.configureUploadCors.mockRejectedValueOnce(new Error('CORS temporarily unavailable'));
    const app = await boot();
    expect((await app.request('/health')).status).toBe(503);
    expect(mocks.configureUploadCors).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(999);
    expect(mocks.ensureBucket).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect((await app.request('/health')).status).toBe(503);
    await vi.advanceTimersByTimeAsync(1999);
    expect(mocks.ensureBucket).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    const response = await app.request('/health');
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ status: 'ok', storage: { ready: true } });
    expect(mocks.configureUploadCors).toHaveBeenLastCalledWith(['https://docs.example.test']);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(mocks.ensureBucket).toHaveBeenCalledTimes(3);
  });

  it('caps backoff and cancels reconciliation when shutting down', async () => {
    mocks.ensureBucket.mockRejectedValue(new Error('storage offline'));
    const app = await boot();
    for (const delay of [1000, 2000, 4000, 8000, 16_000, 30_000, 30_000]) await vi.advanceTimersByTimeAsync(delay);
    expect(mocks.ensureBucket).toHaveBeenCalledTimes(8);
    const shutdown = listenersOf('SIGTERM').find((listener) => !previousListeners.get('SIGTERM')?.includes(listener));
    shutdown?.('SIGTERM');
    await vi.advanceTimersByTimeAsync(60_000);
    expect(mocks.ensureBucket).toHaveBeenCalledTimes(8);
    expect((await app.request('/health')).status).toBe(503);
  });
});
