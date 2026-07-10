import { workbench } from '@getworkbench/hono';
import { queues } from '@nibleaf/bullmq/queues';
import { Hono } from 'hono';
import { env } from '../../env';

// Workbench — a modern BullMQ dashboard, mounted on the worker's Hono app at /jobs.
const workbenchAuth = env.WORKBENCH_USER && env.WORKBENCH_PASS ? { username: env.WORKBENCH_USER, password: env.WORKBENCH_PASS } : undefined;

const app = new Hono()
  .get('/health', (ctx) => ctx.json({ status: 'ok', service: 'worker' }))
  .route(
    '/jobs',
    workbench({
      queues: Object.values(queues),
      title: 'Nibleaf Queues',
      // Workbench's optional alert manager creates its own Redis connection at
      // module load. Nibleaf deliberately disables Redis offline queuing, so
      // that eager startup can reject before Redis is ready and restart the
      // whole worker. The dashboard itself remains available without alerts.
      alerts: { enabled: false },
      ...(workbenchAuth ? { auth: workbenchAuth } : {}),
    }),
  );

export type SystemApp = typeof app;

export default app;
