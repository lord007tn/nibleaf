import { serve } from '@hono/node-server';
import { bootWorkers, closeQueueEvents, closeQueues, closeWorkers } from '@nibleaf/bullmq/workers';
import { logger } from '@nibleaf/logger';
import { env } from './env';
import systemApp from './modules/system/handlers';
import { processors } from './processors';
import { startDeploymentReaper } from './reaper';

process.on('unhandledRejection', (reason) => {
  logger.error({ err: reason instanceof Error ? reason : new Error(String(reason)) }, 'unhandled rejection');
  process.exit(1);
});
process.on('uncaughtException', (error) => {
  logger.error({ error }, 'uncaught exception');
  process.exit(1);
});

let server: ReturnType<typeof serve> | null = null;
let reaperTimer: NodeJS.Timeout | null = null;

async function main() {
  server = serve({ port: env.WORKER_PORT, fetch: systemApp.fetch }, (info) => {
    logger.info(`Nibleaf worker ops server on http://localhost:${info.port}`);
    logger.info(`  health → http://localhost:${info.port}/health`);
    logger.info(`  jobs   → http://localhost:${info.port}/jobs`);
  });

  await bootWorkers(processors);
  // Sweep deployments stranded by a crash mid-build back to FAILED.
  reaperTimer = startDeploymentReaper();
  logger.info('Queue workers started');
}

async function cleanup() {
  if (reaperTimer) {
    clearInterval(reaperTimer);
  }
  await Promise.allSettled([closeWorkers(), closeQueueEvents(), closeQueues()]);
  server?.close();
}

async function shutdown(signal: string) {
  logger.info({ signal }, 'shutting down worker');
  await cleanup();
  process.exit(0);
}

process.on('SIGTERM', () => {
  shutdown('SIGTERM').catch(() => process.exit(1));
});
process.on('SIGINT', () => {
  shutdown('SIGINT').catch(() => process.exit(1));
});

main().catch((error) => {
  logger.error({ error }, 'fatal worker startup error');
  process.exit(1);
});
