import { serve } from '@hono/node-server';
import { bootWorkers, closeQueueEvents, closeQueues, closeWorkers } from '@plume/bullmq/workers';
import { logger } from '@plume/logger';
import { env } from './env';
import { processors } from './processors';
import systemApp from './modules/system/handlers';

process.on('unhandledRejection', (reason) => {
  logger.error({ reason }, 'unhandled rejection');
  process.exit(1);
});
process.on('uncaughtException', (error) => {
  logger.error({ error }, 'uncaught exception');
  process.exit(1);
});

let server: ReturnType<typeof serve> | null = null;

async function main() {
  server = serve({ port: env.WORKER_PORT, fetch: systemApp.fetch }, (info) => {
    logger.info(`Plume worker ops server on http://localhost:${info.port}`);
    logger.info(`  health → http://localhost:${info.port}/health`);
    logger.info(`  jobs   → http://localhost:${info.port}/jobs`);
  });

  await bootWorkers(processors);
  logger.info('Queue workers started');
}

async function cleanup() {
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
