import { keys as auth } from '@plume/auth/keys.server';
import { keys as bullmq } from '@plume/bullmq/keys';
import { keys as database } from '@plume/database/keys';
import { keys as search } from '@plume/search/keys';
import { keys as storage } from '@plume/storage/keys';
import { createEnv } from '@t3-oss/env-core';
import { z } from 'zod';
import { Env } from './constants';

const csv = (value: string): string[] =>
  value
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);

export const env = createEnv({
  extends: [auth(), bullmq(), database(), search(), storage()],
  server: {
    NODE_ENV: z.enum(Env).default('development'),
    APP_NAME: z.string().default('Plume'),
    API_PORT: z.coerce.number().default(4311),
    API_URL: z.url().default('http://localhost:4311'),
    APP_URL: z.url().default('http://localhost:4310'),
    WWW_URL: z.url().default('http://localhost:4313'),
    SERVICE_NAME: z.string().default('plume-api'),
    CORS_ALLOWED_ORIGINS: z.string().default('http://localhost:4310,http://localhost:4313').transform(csv),
    EMAIL_FROM: z.string().default('plume@localhost'),
    OPENAI_API_KEY: z.string().optional(),
  },
  runtimeEnv: process.env,
  emptyStringAsUndefined: true,
});
