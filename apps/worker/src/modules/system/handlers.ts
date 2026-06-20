import { workbench } from '@getworkbench/hono';
import { queues } from '@plume/bullmq/queues';
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
      title: 'Plume Queues',
      ...(workbenchAuth ? { auth: workbenchAuth } : {}),
    }),
  );

export type SystemApp = typeof app;

export default app;
