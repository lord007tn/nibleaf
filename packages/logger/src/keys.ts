import { createEnv } from '@t3-oss/env-core';
import { z } from 'zod';

export const keys = () =>
  createEnv({
    server: {
      NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
      PINO_LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).optional(),
      /** Optional durable JSONL destination. Containers should mount its parent
       * directory when persistence beyond the container filesystem is required. */
      PINO_LOG_FILE: z.string().trim().min(1).optional(),
      SERVICE_NAME: z.string().default('nibleaf'),
    },
    runtimeEnv: process.env,
    emptyStringAsUndefined: true,
  });
