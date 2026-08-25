import './lib/serialize-bigint';

import { type ServerType, serve } from '@hono/node-server';
import { closeQueues, scheduleAnalyticsRollup } from '@nibleaf/bullmq';
import { clickHouseHealth, closeClickHouseClients, initializeClickHouseFn } from '@nibleaf/clickhouse';
import { logger } from '@nibleaf/logger';
import { configureUploadCors, ensureBucket } from '@nibleaf/storage';
import { Scalar } from '@scalar/hono-api-reference';
import { openAPIRouteHandler } from 'hono-openapi';
import { env } from './env';
import app from './routes';

// Fail fast on unhandled async/sync errors rather than running in an undefined state.
process.on('unhandledRejection', (reason) => {
  logger.error({ reason }, 'unhandledRejection');
  process.exit(1);
});
process.on('uncaughtException', (error) => {
  logger.error({ error }, 'uncaughtException');
  process.exit(1);
});

let server: ServerType | null = null;
let shuttingDown = false;
let ready = false;

app.get(
  '/openapi.json',
  openAPIRouteHandler(app, {
    documentation: {
      info: { title: 'Nibleaf API', version: '0.1.1', description: 'Open-source documentation platform.' },
      servers: [{ url: env.API_URL, description: 'Nibleaf API' }],
    },
  }),
);

app.get('/docs', Scalar({ theme: 'default', sources: [{ url: '/openapi.json', title: 'Nibleaf API' }] }));

app.get('/health', async (ctx) => {
  const analytics = await clickHouseHealth();
  const status = shuttingDown ? 'shutting_down' : ready ? 'ok' : 'starting';
  return ctx.json(
    { status, service: env.SERVICE_NAME, revision: process.env.NIBLEAF_REVISION ?? 'development', analytics },
    ready && !shuttingDown ? 200 : 503,
  );
});

async function main() {
  await initializeClickHouseFn({ roles: ['reader'] });
  server = serve({ port: env.API_PORT, fetch: app.fetch }, (info) => {
    logger.info(`Nibleaf API on http://localhost:${info.port}`);
    logger.info(`  docs   → http://localhost:${info.port}/docs`);
    logger.info(`  health → http://localhost:${info.port}/health`);
  });

  // Best-effort storage bootstrap: create the bucket + allow browser uploads.
  await ensureBucket().catch((error) => logger.warn({ error }, 'ensureBucket failed (continuing)'));
  if (env.STORAGE_AUTO_CORS) {
    await configureUploadCors(env.STORAGE_CORS_ALLOWED_ORIGINS)
      .then(() => logger.info({ origins: env.STORAGE_CORS_ALLOWED_ORIGINS }, 'bucket CORS applied for direct uploads'))
      .catch((error) => logger.warn({ error }, 'bucket CORS apply failed (browser uploads may be blocked)'));
  }

  // Redis is a required deployment dependency. Scheduling is idempotent and
  // doubles as the producer readiness gate; do not route traffic to an API
  // whose publish/email/export jobs would only fail after accepting requests.
  await scheduleAnalyticsRollup();
  ready = true;
  logger.info({ revision: process.env.NIBLEAF_REVISION ?? 'development' }, 'API ready');
}

async function shutdown(signal: string) {
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;
  ready = false;
  logger.info({ signal }, 'shutting down API');

  const activeServer = server;
  if (activeServer) {
    let timeout: NodeJS.Timeout | undefined;
    await Promise.race([
      new Promise<void>((resolve, reject) => {
        activeServer.close((error) => (error ? reject(error) : resolve()));
      }),
      new Promise<void>((resolve) => {
        timeout = setTimeout(() => {
          logger.warn({ timeoutMs: env.SERVER_SHUTDOWN_TIMEOUT_MS }, 'API drain timed out; closing active connections');
          (activeServer as typeof activeServer & { closeAllConnections?: () => void }).closeAllConnections?.();
          resolve();
        }, env.SERVER_SHUTDOWN_TIMEOUT_MS);
        timeout.unref();
      }),
    ]).finally(() => {
      if (timeout) {
        clearTimeout(timeout);
      }
    });
  }
  await Promise.allSettled([closeQueues(), closeClickHouseClients()]);
  process.exit(0);
}

process.on('SIGTERM', () => {
  shutdown('SIGTERM').catch((error) => {
    logger.error({ error }, 'API shutdown failed');
    process.exit(1);
  });
});
process.on('SIGINT', () => {
  shutdown('SIGINT').catch((error) => {
    logger.error({ error }, 'API shutdown failed');
    process.exit(1);
  });
});

main().catch((error) => {
  logger.error({ error }, 'fatal API startup error');
  process.exit(1);
});
