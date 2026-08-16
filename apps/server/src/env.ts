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
    /** Provisioning backend. `ingress` keeps the portable/self-hosted DNS + TLS
     * flow; `cloudflare-saas` provisions Custom Hostnames and edge certificates. */
    CUSTOM_DOMAIN_PROVIDER: z.enum(['ingress', 'cloudflare-saas']).default('ingress'),
    CLOUDFLARE_SAAS_ZONE_ID: z.string().optional(),
    CLOUDFLARE_SAAS_API_TOKEN: z.string().optional(),
    CLOUDFLARE_SAAS_WORKER_SCRIPT: z.string().default('nibleaf-custom-domain-edge'),
    SERVICE_NAME: z.string().default('nibleaf-api'),
    CORS_ALLOWED_ORIGINS: z.string().default('http://localhost:4310,http://localhost:4315').transform(csv),
    EMAIL_FROM: z.string().default('nibleaf@localhost'),
    OPENAI_API_KEY: z.string().optional(),
    EXPORT_MAX_ACTIVE_PER_PROJECT: z.coerce.number().int().min(1).max(20).default(3),
    EXPORT_MAX_DAILY_PER_PROJECT: z.coerce.number().int().min(1).max(1000).default(20),
    EXPORT_MAX_PAGES: z.coerce.number().int().positive().default(5000),
    EXPORT_MAX_SNAPSHOT_BYTES: z.coerce
      .number()
      .int()
      .positive()
      .default(50 * 1024 * 1024),
    EXPORT_MANUAL_RETENTION_DAYS: z.coerce.number().int().min(1).max(3650).default(7),
    EXPORT_DOWNLOAD_TTL_SECONDS: z.coerce.number().int().min(30).max(900).default(300),
  },
  runtimeEnv: process.env,
  emptyStringAsUndefined: true,
});
