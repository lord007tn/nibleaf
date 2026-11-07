import './lib/serialize-bigint';

import { type ServerType, serve } from '@hono/node-server';
import { closeQueues, scheduleAnalyticsRollup } from '@nibleaf/bullmq';
import { closeClickHouseClients, getAnalyticsHealth, initializeClickHouseFn } from '@nibleaf/clickhouse';
import { logger } from '@nibleaf/logger';
import { configureUploadCors, ensureBucket } from '@nibleaf/storage';
import { Scalar } from '@scalar/hono-api-reference';
import { openAPIRouteHandler } from 'hono-openapi';
import { env } from './env';
import { chatBudgetWarning } from './lib/ai-search/chat-budget';
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
let storageReady = false;
let storageCors: boolean | null = env.STORAGE_AUTO_CORS ? false : null;
let storageRetry: NodeJS.Timeout | undefined;

app.get(
  '/openapi.json',
  openAPIRouteHandler(app, {
    // Validation is mapped to Nibleaf's documented 422 AppError envelope.
    defaultValidationErrorResponse: false,
    documentation: {
      info: { title: 'Nibleaf API', version: '0.1.1', description: 'Open-source documentation platform.' },
      servers: [{ url: env.API_URL, description: 'Nibleaf API' }],
    },
  }),
);

app.get('/docs', Scalar({ theme: 'default', sources: [{ url: '/openapi.json', title: 'Nibleaf API' }] }));

app.get('/health', async (ctx) => {
  const analytics = await getAnalyticsHealth();
  const healthy = ready && (!env.STORAGE_REQUIRED_FOR_HEALTH || storageReady) && !shuttingDown;
  const status = shuttingDown ? 'shutting_down' : healthy ? 'ok' : 'starting';
  return ctx.json(
    {
      status,
      service: env.SERVICE_NAME,
      revision: process.env.NIBLEAF_REVISION ?? 'development',
      analytics,
      storage: { ready: storageReady, cors: storageCors, requiredForHealth: env.STORAGE_REQUIRED_FOR_HEALTH },
    },
    healthy ? 200 : 503,
  );
});

async function bootstrapStorage(delayMs = 1000): Promise<void> {
  if (!storageReady) {
    try {
      await ensureBucket();
      storageReady = true;
      logger.info('Storage bucket check succeeded');
    } catch (error) {
      logger.warn({ error, retryMs: delayMs }, 'Storage bucket check failed; retrying. Object-only credentials may lack HeadBucket permission');
    }
  }
  if (env.STORAGE_AUTO_CORS && !storageCors) {
    try {
      await configureUploadCors(env.STORAGE_CORS_ALLOWED_ORIGINS);
      storageCors = true;
    } catch (error) {
      logger.warn(
        { error, retryMs: delayMs },
        'Storage upload CORS setup failed; configure CORS externally or set STORAGE_AUTO_CORS=false. CORS does not gate API health',
      );
    }
  }
  if (!shuttingDown && (!storageReady || (env.STORAGE_AUTO_CORS && !storageCors))) {
    storageRetry = setTimeout(() => void bootstrapStorage(Math.min(delayMs * 2, 30_000)), delayMs);
    storageRetry.unref();
  }
}

async function main() {
  void initializeClickHouseFn({ roles: ['reader'] });
  server = serve({ port: env.API_PORT, fetch: app.fetch }, (info) => {
    logger.info(`Nibleaf API on http://localhost:${info.port}`);
    logger.info(`  docs   → http://localhost:${info.port}/docs`);
    logger.info(`  health → http://localhost:${info.port}/health`);
  });

  // Reconcile bucket access and CORS independently; bucket diagnostics gate
  // health only when the operator explicitly requires that permission check.
  void bootstrapStorage();

  // Redis is a required deployment dependency. Scheduling is idempotent and
  // doubles as the producer readiness gate; do not route traffic to an API
  // whose publish/email/export jobs would only fail after accepting requests.
  await scheduleAnalyticsRollup();
  const chatBudget = chatBudgetWarning();
  if (chatBudget?.settings.length)
    logger.warn(chatBudget, 'AI chat token budgets are below the most room one question can need; such questions will be refused');
  else if (chatBudget) logger.warn(chatBudget, 'AI chat token budgets leave room for only a few questions; consider raising them');
  ready = true;
  logger.info({ revision: process.env.NIBLEAF_REVISION ?? 'development' }, 'API initialized; see /health for readiness');
}

async function shutdown(signal: string) {
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;
  clearTimeout(storageRetry);
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
