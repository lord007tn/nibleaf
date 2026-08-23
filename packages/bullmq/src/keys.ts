import { createEnv } from '@t3-oss/env-core';
import { z } from 'zod';

export const keys = () =>
  createEnv({
    server: {
      NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
      REDIS_HOST: z.string().default('localhost'),
      REDIS_PORT: z.coerce.number().default(6379),
      REDIS_PASSWORD: z.string().optional(),
      REDIS_DB: z.coerce.number().default(0),
      QUEUE_CLUSTER: z.stringbool().default(true),
      // Comma-separated allowlist of queues this process runs workers for.
      // Empty = all queues (single-worker deployment).
      WORKER_QUEUES: z
        .string()
        .default('')
        .transform((value) =>
          value
            .split(',')
            .map((name) => name.trim())
            .filter(Boolean),
        ),
      PUBLISH_CONCURRENCY: z.coerce.number().default(2),
      SEARCH_CONCURRENCY: z.coerce.number().default(4),
      EMAIL_CONCURRENCY: z.coerce.number().default(3),
      ANALYTICS_CONCURRENCY: z.coerce.number().default(10),
      EXPORT_CONCURRENCY: z.coerce.number().int().min(1).max(8).default(2),
      GIT_CONCURRENCY: z.coerce.number().default(2),
    },
    runtimeEnv: process.env,
    emptyStringAsUndefined: true,
  });

/** Whether this process should boot a worker for the given queue (see WORKER_QUEUES). */
export const isQueueEnabled = (queue: string): boolean => {
  const allowed = keys().WORKER_QUEUES;
  return allowed.length === 0 || allowed.includes(queue);
};
