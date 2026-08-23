import { createEnv } from '@t3-oss/env-core';
import { z } from 'zod';

export const analyticsModeSchema = z.enum(['disabled', 'dual_write', 'shadow_read', 'clickhouse']);
export type AnalyticsMode = z.infer<typeof analyticsModeSchema>;

const optionalSecret = z.string().min(1).optional();

export const keys = () =>
  createEnv({
    server: {
      ANALYTICS_MODE: analyticsModeSchema.default('disabled'),
      ANALYTICS_HASH_SALT: optionalSecret,
      CLICKHOUSE_URL: z.url().default('http://localhost:8123'),
      CLICKHOUSE_DATABASE: z
        .string()
        .regex(/^[a-zA-Z_][a-zA-Z0-9_]{0,62}$/u)
        .default('nibleaf_analytics'),
      CLICKHOUSE_READER_USERNAME: z.string().min(1).default('default'),
      CLICKHOUSE_READER_PASSWORD: z.string().optional(),
      CLICKHOUSE_WRITER_USERNAME: z.string().min(1).default('default'),
      CLICKHOUSE_WRITER_PASSWORD: z.string().optional(),
      CLICKHOUSE_REQUEST_TIMEOUT_MS: z.coerce.number().int().min(250).max(60_000).default(5000),
      CLICKHOUSE_MAX_BATCH_SIZE: z.coerce.number().int().min(1).max(10_000).default(500),
      CLICKHOUSE_MAX_BUFFERED_EVENTS: z.coerce.number().int().min(100).max(100_000).default(10_000),
      CLICKHOUSE_FLUSH_INTERVAL_MS: z.coerce.number().int().min(25).max(30_000).default(1000),
      CLICKHOUSE_RAW_RETENTION_DAYS: z.coerce.number().int().min(7).max(730).default(180),
      CLICKHOUSE_ROLLUP_RETENTION_DAYS: z.coerce.number().int().min(30).max(3650).default(730),
      CLICKHOUSE_SENSITIVE_RETENTION_DAYS: z.coerce.number().int().min(1).max(90).default(30),
    },
    runtimeEnv: process.env,
    emptyStringAsUndefined: true,
  });

export type ClickHouseKeys = ReturnType<typeof keys>;

export const relationalWritesEnabled = (mode: AnalyticsMode): boolean => mode !== 'clickhouse';
export const clickHouseWritesEnabled = (mode: AnalyticsMode): boolean => mode !== 'disabled';
export const clickHouseReadsEnabled = (mode: AnalyticsMode): boolean => mode === 'shadow_read' || mode === 'clickhouse';
