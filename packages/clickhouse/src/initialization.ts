import type { ClickHouseClient } from '@clickhouse/client';
import { createLogger } from '@nibleaf/logger';
import { type AnalyticsHealth, type ClickHouseClientRole, getClickHouseClient } from './client';
import { keys } from './keys';
import { redactAnalyticsDiagnostics } from './redaction';

const log = createLogger({ package: 'clickhouse', lifecycle: 'initialization' });

/** Initialize only the clients a process owns and verify their credentials.
 * Schema migrations remain an explicit deployment step; a transient analytics
 * outage is reported but never prevents the transactional product from booting. */
export async function initializeClickHouseFn(
  options: { roles?: ClickHouseClientRole[]; clientForRole?: (role: ClickHouseClientRole) => ClickHouseClient } = {},
) {
  const config = keys();
  const roles = [...new Set<ClickHouseClientRole>(options.roles ?? ['reader'])];
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

export type AnalyticsInitialization = Awaited<ReturnType<typeof initializeClickHouseFn>> & AnalyticsHealth;
