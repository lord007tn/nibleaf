import './lib/serialize-bigint';

import { timingSafeEqual } from 'node:crypto';
import { type ServerType, serve } from '@hono/node-server';
import { closeQueues, scheduleAnalyticsRollup } from '@nibleaf/bullmq';
import { closeClickHouseClients, getAnalyticsHealth, initializeClickHouseFn } from '@nibleaf/clickhouse';
import { logger } from '@nibleaf/logger';
import { configureUploadCors, ensureBucket } from '@nibleaf/storage';
import { Scalar } from '@scalar/hono-api-reference';
import { openAPIRouteHandler } from 'hono-openapi';
import { version } from '../package.json';
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
let bucketBootstrapStopped = false;
let corsBootstrapStopped = false;

function storageCredentialsRejected(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const failure = error as { name?: string; code?: string; $metadata?: { httpStatusCode?: number } };
  return (
    failure.$metadata?.httpStatusCode === 401 ||
    failure.$metadata?.httpStatusCode === 403 ||
    ['AccessDenied', 'AccessDeniedException', 'Forbidden', 'InvalidAccessKeyId', 'SignatureDoesNotMatch', 'InvalidToken', 'ExpiredToken'].some(
      (code) => failure.name === code || failure.code === code,
    )
  );
}

function healthStatus() {
  const healthy = ready && (!env.STORAGE_REQUIRED_FOR_HEALTH || storageReady) && !shuttingDown;
  return { status: shuttingDown ? 'shutting_down' : healthy ? 'ok' : 'starting', code: healthy ? 200 : 503 } as const;
}

const storageHealth = () => ({
  ready: storageReady,
  cors: storageCors,
  requiredForHealth: env.STORAGE_REQUIRED_FOR_HEALTH,
  bucketBootstrapStopped,
  corsBootstrapStopped,
});

app.get(
  '/openapi.json',
  openAPIRouteHandler(app, {
    // Validation is mapped to Nibleaf's documented 422 AppError envelope.
    defaultValidationErrorResponse: false,
    documentation: {
      info: { title: 'Nibleaf API', version, description: 'Open-source documentation platform.' },
      servers: [{ url: env.API_URL, description: 'Nibleaf API' }],
    },
  }),
);

app.get('/docs', Scalar({ theme: 'default', sources: [{ url: '/openapi.json', title: 'Nibleaf API' }] }));

app.get('/health', (ctx) => {
  const { status, code } = healthStatus();
  ctx.header('cache-control', 'no-store');
  return ctx.json({ status, revision: process.env.NIBLEAF_REVISION ?? 'development' }, code);
});

app.get('/health/details', async (ctx) => {
  ctx.header('cache-control', 'private, no-store');
  // Match the existing internal API proof: fail closed when the secret is unset
  // and compare the x-nibleaf-internal header without a timing-sensitive value check.
  const secret = process.env.INTERNAL_API_SECRET;
  const provided = ctx.req.header('x-nibleaf-internal');
  if (!secret || !provided) return ctx.json({ status: 'unauthorized' }, 401);
  const expectedBytes = Buffer.from(secret);
  const providedBytes = Buffer.from(provided);
  if (expectedBytes.length !== providedBytes.length || !timingSafeEqual(expectedBytes, providedBytes)) {
    return ctx.json({ status: 'unauthorized' }, 401);
  }
  const { status, code } = healthStatus();
  const analytics = await getAnalyticsHealth();
  return ctx.json(
    {
      status,
      service: env.SERVICE_NAME,
      revision: process.env.NIBLEAF_REVISION ?? 'development',
      analytics,
      storage: storageHealth(),
    },
    code,
  );
});

async function bootstrapStorage(attempt = 1, delayMs = 1000): Promise<void> {
  if (!storageReady && !bucketBootstrapStopped) {
    try {
      await ensureBucket();
      storageReady = true;
      logger.info('Storage bucket check succeeded');
    } catch (error) {
      bucketBootstrapStopped = storageCredentialsRejected(error);
      logger[bucketBootstrapStopped || attempt === 1 || attempt % 10 === 0 ? 'warn' : 'debug'](
        { error, attempt, stopped: bucketBootstrapStopped, retryMs: bucketBootstrapStopped ? null : delayMs },
        bucketBootstrapStopped
          ? 'Storage bucket bootstrap stopped: fix rejected storage credentials or bucket permissions, then restart the API'
          : 'Storage bucket check failed; retrying automatically',
      );
    }
  }
  if (env.STORAGE_AUTO_CORS && !storageCors && !corsBootstrapStopped) {
    try {
      await configureUploadCors(env.STORAGE_CORS_ALLOWED_ORIGINS);
      storageCors = true;
    } catch (error) {
      corsBootstrapStopped = storageCredentialsRejected(error);
      logger[corsBootstrapStopped || attempt === 1 || attempt % 10 === 0 ? 'warn' : 'debug'](
        { error, attempt, stopped: corsBootstrapStopped, retryMs: corsBootstrapStopped ? null : delayMs },
        corsBootstrapStopped
          ? 'Storage CORS bootstrap stopped: fix credentials or CORS permissions and restart the API, or manage CORS externally with STORAGE_AUTO_CORS=false. CORS does not gate API health'
          : 'Storage upload CORS setup failed; retrying automatically. CORS does not gate API health',
      );
    }
  }
  logger.debug({ storage: storageHealth() }, 'Storage bootstrap status');
  if (!shuttingDown && ((!storageReady && !bucketBootstrapStopped) || (env.STORAGE_AUTO_CORS && !storageCors && !corsBootstrapStopped))) {
    storageRetry = setTimeout(() => void bootstrapStorage(attempt + 1, Math.min(delayMs * 2, 30_000)), delayMs);
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
