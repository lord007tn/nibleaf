import { keys as bullmq } from '@nibleaf/bullmq/keys';
import { keys as database } from '@nibleaf/database/keys';
import { keys as qdrant } from '@nibleaf/qdrant/keys';
import { keys as search } from '@nibleaf/search/keys';
import { keys as storage } from '@nibleaf/storage/keys';
import { createEnv } from '@t3-oss/env-core';
import { z } from 'zod';

export const env = createEnv({
  extends: [bullmq(), database(), qdrant(), search(), storage()],
  server: {
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    WORKER_PORT: z.coerce.number().default(4312),
    API_URL: z.url().default('http://localhost:4311'),
    POSTMARK_API_KEY: z.string().optional(),
    POSTMARK_MESSAGE_STREAM: z.string().optional(),
    SMTP_URL: z.string().optional(),
    EMAIL_DELIVERY_REQUIRED: z
      .enum(['true', 'false', '1', '0'])
      .optional()
      .transform((value) => (value === undefined ? process.env.NODE_ENV === 'production' : value === 'true' || value === '1')),
    EMAIL_FROM: z.string().default('nibleaf@localhost'),
    WORKBENCH_USER: z.string().optional(),
    WORKBENCH_PASS: z.string().optional(),
    EXPORT_CHROMIUM_PATH: z.string().default('/usr/bin/chromium-browser'),
    EXPORT_MAX_ASSET_BYTES: z.coerce
      .number()
      .int()
      .positive()
      .default(250 * 1024 * 1024),
    EXPORT_MAX_PAGES: z.coerce.number().int().positive().default(5000),
    EXPORT_MAX_SNAPSHOT_BYTES: z.coerce
      .number()
      .int()
      .positive()
      .default(50 * 1024 * 1024),
    GIT_WORKER_SECRET: z.string().min(32).optional(),
    OPENAI_API_KEY: z.string().optional(),
  },
  runtimeEnv: process.env,
  emptyStringAsUndefined: true,
});
