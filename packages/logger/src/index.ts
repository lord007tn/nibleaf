import { dirname, resolve } from 'node:path';
import { log as evlog, initLogger } from 'evlog';
import { createFsDrain } from 'evlog/fs';
import { z } from 'zod';
import { keys } from './keys';

const env = keys();
const configuredLevel = env.EVLOG_LOG_LEVEL ?? env.PINO_LOG_LEVEL ?? (env.NODE_ENV === 'production' ? 'info' : 'debug');
const minLevel =
  configuredLevel === 'fatal' || configuredLevel === 'error'
    ? 'error'
    : configuredLevel === 'trace'
      ? 'debug'
      : configuredLevel === 'silent'
        ? 'debug'
        : configuredLevel;
const logDirectory = env.EVLOG_FS_DIR ?? (env.PINO_LOG_FILE ? dirname(resolve(env.PINO_LOG_FILE)) : undefined);

initLogger({
  drain: logDirectory
    ? createFsDrain({
        dir: logDirectory,
        maxFiles: env.EVLOG_FS_MAX_FILES,
        maxSizePerFile: env.EVLOG_FS_MAX_SIZE_BYTES,
        pretty: false,
      })
    : undefined,
  enabled: configuredLevel !== 'silent',
  env: {
    environment: env.NODE_ENV,
    service: env.SERVICE_NAME,
  },
  minLevel,
  pretty: env.NODE_ENV !== 'production',
  redact: {
    builtins: ['jwt', 'bearer'],
    paths: [
      'authorization',
      'proxy-authorization',
      'cookie',
      'set-cookie',
      'password',
      'passcode',
      'secret',
      'clientSecret',
      'client_secret',
      'token',
      '*_token',
      '*Token',
      'apiKey',
      'api_key',
      'x-api-key',
      'x-auth-token',
    ],
  },
});

const recordSchema = z.record(z.string(), z.unknown());

const serializeError = (error: Error) => ({
  message: error.message,
  name: error.name,
  stack: error.stack,
  ...(('code' in error && typeof error.code === 'string' && { code: error.code }) || {}),
});

const normalizeRecord = (record: Record<string, unknown>) => ({
  ...record,
  ...(record.error instanceof Error && { error: serializeError(record.error) }),
  ...(record.err instanceof Error && { err: serializeError(record.err) }),
});

const eventFromInput = (bindings: Record<string, unknown>, input: unknown, message?: string) => {
  const event: Record<string, unknown> = { ...bindings };
  if (input instanceof Error) {
    event.error = serializeError(input);
  } else {
    const parsed = recordSchema.safeParse(input);
    if (parsed.success) {
      Object.assign(event, normalizeRecord(parsed.data));
    } else if (typeof input === 'string') {
      event.message = input;
    } else if (input !== undefined) {
      event.value = String(input);
    }
  }
  if (message) {
    event.message = message;
  }
  return event;
};

export interface Logger {
  child(bindings: Record<string, unknown>): Logger;
  debug(input: unknown, message?: string): void;
  error(input: unknown, message?: string): void;
  info(input: unknown, message?: string): void;
  warn(input: unknown, message?: string): void;
}

const createChildLogger = (bindings: Record<string, unknown> = {}): Logger => ({
  child: (childBindings) => createChildLogger({ ...bindings, ...recordSchema.parse(childBindings) }),
  debug: (input, message) => evlog.debug(eventFromInput(bindings, input, message)),
  error: (input, message) => evlog.error(eventFromInput(bindings, input, message)),
  info: (input, message) => evlog.info(eventFromInput(bindings, input, message)),
  warn: (input, message) => evlog.warn(eventFromInput(bindings, input, message)),
});

export const logger = createChildLogger();

/** Create a child logger scoped to a component (queue, module, etc.). */
export const createLogger = (bindings: Record<string, unknown>) => logger.child(bindings);
