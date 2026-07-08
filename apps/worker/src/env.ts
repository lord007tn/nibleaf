import { keys as bullmq } from '@nibleaf/bullmq/keys';
import { keys as database } from '@nibleaf/database/keys';
import { createEnv } from '@t3-oss/env-core';
import { z } from 'zod';

export const env = createEnv({
  extends: [bullmq(), database()],
  server: {
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    WORKER_PORT: z.coerce.number().default(4312),
    API_URL: z.url().default('http://localhost:4311'),
    POSTMARK_API_KEY: z.string().optional(),
    POSTMARK_MESSAGE_STREAM: z.string().optional(),
    SMTP_URL: z.string().optional(),
    EMAIL_FROM: z.string().default('nibleaf@localhost'),
    WORKBENCH_USER: z.string().optional(),
    WORKBENCH_PASS: z.string().optional(),
  },
  runtimeEnv: process.env,
  emptyStringAsUndefined: true,
});
