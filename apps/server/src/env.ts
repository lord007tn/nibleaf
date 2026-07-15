import { keys as auth } from '@nibleaf/auth/keys.server';
import { keys as bullmq } from '@nibleaf/bullmq/keys';
import { keys as database } from '@nibleaf/database/keys';
import { keys as search } from '@nibleaf/search/keys';
import { keys as storage } from '@nibleaf/storage/keys';
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
    APP_NAME: z.string().default('Nibleaf'),
    API_PORT: z.coerce.number().default(4311),
    SERVER_SHUTDOWN_TIMEOUT_MS: z.coerce.number().int().positive().max(120_000).default(25_000),
    API_URL: z.url().default('http://localhost:4311'),
    APP_URL: z.url().default('http://localhost:4310'),
    ADMIN_URL: z.url().default('http://localhost:4315'),
    SITE_BASE_DOMAIN: z.string().optional(),
    // No SaaS default: a self-hoster must not tell their readers to CNAME to a
    // host they don't control. Falls back to SITE_BASE_DOMAIN in dnsRecords().
    CUSTOM_DOMAIN_CNAME_TARGET: z.string().optional(),
    SERVICE_NAME: z.string().default('nibleaf-api'),
    CORS_ALLOWED_ORIGINS: z.string().default('http://localhost:4310,http://localhost:4315').transform(csv),
    EMAIL_FROM: z.string().default('nibleaf@localhost'),
    OPENAI_API_KEY: z.string().optional(),
  },
  runtimeEnv: process.env,
  emptyStringAsUndefined: true,
});
