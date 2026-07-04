import { keys as auth } from '@midad/auth/keys.server';
import { keys as bullmq } from '@midad/bullmq/keys';
import { keys as database } from '@midad/database/keys';
import { keys as search } from '@midad/search/keys';
import { keys as storage } from '@midad/storage/keys';
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
    APP_NAME: z.string().default('Midad'),
    API_PORT: z.coerce.number().default(4311),
    API_URL: z.url().default('http://localhost:4311'),
    APP_URL: z.url().default('http://localhost:4310'),
    WWW_URL: z.url().default('http://localhost:4313'),
    SITE_BASE_DOMAIN: z.string().optional(),
    // No SaaS default: a self-hoster must not tell their readers to CNAME to a
    // host they don't control. Falls back to SITE_BASE_DOMAIN in dnsRecords().
    CUSTOM_DOMAIN_CNAME_TARGET: z.string().optional(),
    SERVICE_NAME: z.string().default('midad-api'),
    CORS_ALLOWED_ORIGINS: z.string().default('http://localhost:4310,http://localhost:4313,http://localhost:4315').transform(csv),
    EMAIL_FROM: z.string().default('midad@localhost'),
    OPENAI_API_KEY: z.string().optional(),
  },
  runtimeEnv: process.env,
  emptyStringAsUndefined: true,
});
