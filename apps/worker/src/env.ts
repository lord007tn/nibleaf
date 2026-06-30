import { keys as bullmq } from '@midad/bullmq/keys';
import { keys as database } from '@midad/database/keys';
import { createEnv } from '@t3-oss/env-core';
import { z } from 'zod';

export const env = createEnv({
  extends: [bullmq(), database()],
  server: {
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    WORKER_PORT: z.coerce.number().default(4312),
    API_URL: z.url().default('http://localhost:4311'),
    SMTP_URL: z.string().optional(),
    EMAIL_FROM: z.string().default('midad@localhost'),
    WORKBENCH_USER: z.string().optional(),
    WORKBENCH_PASS: z.string().optional(),
  },
  runtimeEnv: process.env,
  emptyStringAsUndefined: true,
});
