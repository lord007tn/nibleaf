import { pino } from 'pino';

const level = process.env.PINO_LOG_LEVEL ?? (process.env.NODE_ENV === 'production' ? 'info' : 'debug');
const isProduction = process.env.NODE_ENV === 'production';

export const logger = pino({
  level,
  base: {
    service: process.env.SERVICE_NAME ?? 'midad',
  },
  ...(isProduction
    ? {}
    : {
        transport: {
          target: 'pino-pretty',
          options: {
            colorize: true,
            translateTime: 'SYS:HH:MM:ss',
            ignore: 'pid,hostname,service',
          },
        },
      }),
});

export type Logger = typeof logger;

/** Create a child logger scoped to a component (queue, module, etc.). */
export const createLogger = (bindings: Record<string, unknown>) => logger.child(bindings);
