import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  createFsDrain: vi.fn(() => vi.fn()),
  initLogger: vi.fn(),
  log: {
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  },
}));

vi.mock('evlog', () => ({ initLogger: mocks.initLogger, log: mocks.log }));
vi.mock('evlog/fs', () => ({ createFsDrain: mocks.createFsDrain }));

const importLogger = async () => {
  vi.resetModules();
  return import('./index');
};

describe('EvLog adapter', () => {
  beforeEach(() => {
    vi.stubEnv('NODE_ENV', 'test');
    vi.stubEnv('SERVICE_NAME', 'logger-test');
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
  });

  it('preserves child bindings and Pino-style structured messages', async () => {
    const { createLogger } = await importLogger();

    createLogger({ component: 'worker' }).child({ queue: 'publish' }).info({ count: 3 }, 'jobs ready');

    expect(mocks.log.info).toHaveBeenCalledWith({ component: 'worker', count: 3, message: 'jobs ready', queue: 'publish' });
  });

  it('serializes direct and nested errors without accepting arrays as records', async () => {
    const { logger } = await importLogger();
    const error = Object.assign(new Error('nope'), { code: 'E_TEST' });

    logger.error({ error }, 'request failed');
    logger.warn(['not', 'fields']);

    expect(mocks.log.error).toHaveBeenCalledWith(
      expect.objectContaining({ error: expect.objectContaining({ code: 'E_TEST', message: 'nope', name: 'Error' }), message: 'request failed' }),
    );
    expect(mocks.log.warn).toHaveBeenCalledWith({ value: 'not,fields' });
  });

  it('configures rotating NDJSON files and secret redaction', async () => {
    vi.stubEnv('EVLOG_FS_DIR', 'var/log/nibleaf');
    vi.stubEnv('EVLOG_FS_MAX_FILES', '5');
    vi.stubEnv('EVLOG_FS_MAX_SIZE_BYTES', '2048');

    await importLogger();

    expect(mocks.createFsDrain).toHaveBeenCalledWith({ dir: 'var/log/nibleaf', maxFiles: 5, maxSizePerFile: 2048, pretty: false });
    expect(mocks.initLogger).toHaveBeenCalledWith(
      expect.objectContaining({
        env: { environment: 'test', service: 'logger-test' },
        minLevel: 'debug',
        redact: expect.objectContaining({ builtins: ['jwt', 'bearer'], paths: expect.arrayContaining(['password', 'token', 'apiKey']) }),
      }),
    );
  });

  it('keeps legacy Pino environment settings deployment-compatible', async () => {
    vi.stubEnv('PINO_LOG_FILE', 'legacy/logs/application.ndjson');
    vi.stubEnv('PINO_LOG_LEVEL', 'silent');

    await importLogger();

    expect(mocks.createFsDrain).toHaveBeenCalledWith(expect.objectContaining({ dir: expect.stringMatching(/[\\/]legacy[\\/]logs$/u) }));
    expect(mocks.initLogger).toHaveBeenCalledWith(expect.objectContaining({ enabled: false }));
  });
});
