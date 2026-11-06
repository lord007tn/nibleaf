import { type ClickHouseClient, createClient } from '@clickhouse/client';
import { createLogger } from '@nibleaf/logger';
import { z } from 'zod';
import { type ClickHouseClientRole, getClickHouseClient } from './client';
import { keys } from './keys';
import { migrations, runClickHouseMigrations } from './migrations';
import { redactAnalyticsDiagnostics } from './redaction';

const log = createLogger({ package: 'clickhouse', lifecycle: 'initialization' });

/** Verify owned credentials without making analytics a core boot dependency. */
export async function initializeClickHouseFn(
  options: { roles?: ClickHouseClientRole[]; clientForRole?: (role: ClickHouseClientRole) => ClickHouseClient } = {},
) {
  const config = keys();
  const roles = [...new Set<ClickHouseClientRole>(options.roles ?? ['reader'])];
  if (!config.ANALYTICS_HASH_SALT && process.env.NODE_ENV === 'production') {
    log.warn(
      'ANALYTICS_HASH_SALT is not set; reader identifiers are hashed with a public fallback salt. Set it to a random value (openssl rand -hex 32).',
    );
  }
  if (config.ANALYTICS_MODE === 'disabled') return { configured: false, latencyMs: null, roles: [], status: 'disabled' };

  const started = performance.now();
  try {
    await Promise.all(
      roles.map(async (role) => {
        const client = options.clientForRole?.(role) ?? getClickHouseClient(role, config);
        const result = await client.query({ query: 'SELECT 1 AS ok', format: 'JSONEachRow' });
        await result.json();
      }),
    );
    const initialized = { configured: true, latencyMs: Math.round(performance.now() - started), roles, status: 'ok' as const };
    log.info({ latencyMs: initialized.latencyMs, roles }, 'ClickHouse analytics clients ready');
    return initialized;
  } catch (error) {
    log.warn({ error: redactAnalyticsDiagnostics(error), roles }, 'ClickHouse analytics unavailable at startup; core product will continue');
    return { configured: true, latencyMs: null, roles, status: 'unavailable' };
  }
}

export type AnalyticsInitialization = Awaited<ReturnType<typeof initializeClickHouseFn>>;

export type AnalyticsStatus = 'ok' | 'migrating' | 'unavailable' | 'disabled' | 'schema_outdated';
export interface AnalyticsSchemaHealth {
  configured: boolean;
  latencyMs: number | null;
  status: AnalyticsStatus;
}

let migrating = false;
let migrationStarted = false;

/** Check versions on every probe so separate API processes observe worker progress. */
export async function getAnalyticsHealth(options: { client?: ClickHouseClient; migrating?: boolean } = {}): Promise<AnalyticsSchemaHealth> {
  if (keys().ANALYTICS_MODE === 'disabled') return { configured: false, latencyMs: null, status: 'disabled' };
  const started = performance.now();
  try {
    const client = options.client ?? getClickHouseClient('reader');
    // Keep optional analytics well inside Docker's core healthcheck timeout.
    const abortSignal = AbortSignal.timeout(750);
    const tables = await client.query({
      query: "SELECT count() AS count FROM system.tables WHERE database = {database:String} AND name = 'analytics_schema_migrations'",
      query_params: { database: keys().CLICKHOUSE_DATABASE },
      abort_signal: abortSignal,
      format: 'JSONEachRow',
    });
    const exists = (await tables.json<{ count: string | number }>())[0];
    let current = false;
    if (Number(exists?.count) > 0) {
      const result = await client.query({
        query: 'SELECT version FROM analytics_schema_migrations FINAL',
        format: 'JSONEachRow',
        abort_signal: abortSignal,
      });
      const applied = new Set((await result.json<{ version: number }>()).map((row) => Number(row.version)));
      current = migrations.every((migration) => applied.has(migration.version));
    }
    return {
      configured: true,
      latencyMs: Math.round(performance.now() - started),
      status: (options.migrating ?? migrating) ? 'migrating' : current ? 'ok' : 'schema_outdated',
    };
  } catch {
    return { configured: true, latencyMs: null, status: 'unavailable' };
  }
}

/** A transaction-scoped Postgres lock is released on failure or process exit.
 * All workers and the explicit CLI must use the same Postgres database. */
async function withMigrationLock(action: () => Promise<void>): Promise<boolean> {
  const { prisma, Prisma } = await import('@nibleaf/database');
  const config = keys();
  return prisma.$transaction(
    async (tx) => {
      const [row] = await tx.$queryRaw<Array<{ locked: boolean }>>(Prisma.sql`
      SELECT pg_try_advisory_xact_lock(hashtextextended(${`nibleaf:clickhouse:migrations:${config.CLICKHOUSE_DATABASE}`}, 904712)) AS locked
    `);
      if (!row?.locked) return false;
      await action();
      return true;
    },
    { timeout: 3_600_000, maxWait: 5000 },
  );
}

/** Shared by background boot and the explicit migration command, including TTL reapplication. */
export async function migrateClickHouseSchema(
  options: { withLock?: (action: () => Promise<void>) => Promise<boolean>; create?: typeof createClient } = {},
): Promise<boolean> {
  return (options.withLock ?? withMigrationLock)(async () => {
    const config = keys();
    const create = options.create ?? createClient;
    const credentials = {
      url: config.CLICKHOUSE_URL,
      username: config.CLICKHOUSE_WRITER_USERNAME,
      password: config.CLICKHOUSE_WRITER_PASSWORD,
      request_timeout: config.CLICKHOUSE_REQUEST_TIMEOUT_MS,
    };
    const admin = create(credentials);
    try {
      await admin.command({ query: `CREATE DATABASE IF NOT EXISTS ${config.CLICKHOUSE_DATABASE}` });
    } finally {
      await admin.close();
    }
    const client = create({ ...credentials, database: config.CLICKHOUSE_DATABASE });
    try {
      const retention = {
        rawRetentionDays: config.CLICKHOUSE_RAW_RETENTION_DAYS,
        rollupRetentionDays: config.CLICKHOUSE_ROLLUP_RETENTION_DAYS,
        sensitiveRetentionDays: config.CLICKHOUSE_SENSITIVE_RETENTION_DAYS,
        crawlerRetentionDays: z.coerce
          .number()
          .int()
          .min(7)
          .max(730)
          .default(90)
          .parse(process.env.CLICKHOUSE_CRAWLER_RETENTION_DAYS || undefined),
      };
      const applied = await runClickHouseMigrations(client, retention);
      log.info({ applied }, 'ClickHouse migrations and retention settings applied');
    } finally {
      await client.close();
    }
  });
}

/** Never awaited by boot. Retry indefinitely with a capped delay; timers do not keep a process alive. */
export async function runClickHouseBootMigrations(
  options: { migrate?: () => Promise<boolean>; wait?: (ms: number) => Promise<void> } = {},
): Promise<void> {
  let attempt = 0;
  try {
    if (keys().ANALYTICS_MODE === 'disabled' || !keys().CLICKHOUSE_MIGRATE_ON_BOOT) return;
    for (;;) {
      migrating = true;
      try {
        if (await (options.migrate ?? migrateClickHouseSchema)()) return;
        log.info('ClickHouse migration lock held by another process; retrying');
      } catch (error) {
        log.warn({ error: redactAnalyticsDiagnostics(error) }, 'ClickHouse migrations unavailable; core boot continues, retrying');
      }
      migrating = false;
      const ms = Math.min(60_000, 1000 * 2 ** Math.min(attempt++, 6));
      await (
        options.wait ??
        ((delay) =>
          new Promise<void>((resolve) => {
            setTimeout(resolve, delay).unref();
          }))
      )(ms);
    }
  } catch (error) {
    log.warn({ error: redactAnalyticsDiagnostics(error) }, 'ClickHouse boot migration configuration invalid; core boot continues');
  } finally {
    migrating = false;
  }
}

export function startClickHouseBootMigrations(): void {
  if (migrationStarted) return;
  migrationStarted = true;
  void runClickHouseBootMigrations();
}
