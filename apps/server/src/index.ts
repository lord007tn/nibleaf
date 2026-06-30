import './lib/serialize-bigint';

import { serve } from '@hono/node-server';
import { scheduleAnalyticsRollup } from '@midad/bullmq';
import { logger } from '@midad/logger';
import { configureUploadCors, ensureBucket } from '@midad/storage';
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

let server: ReturnType<typeof serve> | null = null;

app.get(
  '/openapi.json',
  openAPIRouteHandler(app, {
    documentation: {
      info: { title: 'Midad API', version: '0.1.0', description: 'Open-source documentation platform.' },
      servers: [{ url: env.API_URL, description: 'Midad API' }],
    },
  }),
);

app.get('/docs', Scalar({ theme: 'default', sources: [{ url: '/openapi.json', title: 'Midad API' }] }));

app.get('/health', (ctx) => ctx.json({ status: 'ok', service: env.SERVICE_NAME }));

async function main() {
  server = serve({ port: env.API_PORT, fetch: app.fetch }, (info) => {
    logger.info(`Midad API on http://localhost:${info.port}`);
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

  // Register the repeatable analytics rollup (idempotent).
  await scheduleAnalyticsRollup().catch((error) => logger.warn({ error }, 'could not schedule analytics rollup'));
}

function shutdown(signal: string) {
  logger.info({ signal }, 'shutting down API');
  server?.close();
  process.exit(0);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

main().catch((error) => {
  logger.error({ error }, 'fatal API startup error');
  process.exit(1);
});
