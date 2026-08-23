import { pino, type TransportMultiOptions } from 'pino';
import { keys } from './keys';

const env = keys();
const level = env.PINO_LOG_LEVEL ?? (process.env.NODE_ENV === 'production' ? 'info' : 'debug');
const isProduction = process.env.NODE_ENV === 'production';

const terminalTarget: TransportMultiOptions['targets'][number] = isProduction
  ? { target: 'pino/file', level, options: { destination: 1 } }
  : {
      target: 'pino-pretty',
      level,
      options: { colorize: true, translateTime: 'SYS:HH:MM:ss', ignore: 'pid,hostname,service' },
    };
const targets: TransportMultiOptions['targets'] = [
  terminalTarget,
  ...(env.PINO_LOG_FILE ? [{ target: 'pino/file', level, options: { destination: env.PINO_LOG_FILE, mkdir: true } }] : []),
];

export const logger = pino({
  level,
  base: {
    service: process.env.SERVICE_NAME ?? 'nibleaf',
  },
  transport: { targets },
});

export type Logger = typeof logger;

/** Create a child logger scoped to a component (queue, module, etc.). */
export const createLogger = (bindings: Record<string, unknown>) => logger.child(bindings);
