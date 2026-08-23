import { workbench } from '@getworkbench/hono';
import { queues } from '@nibleaf/bullmq/queues';
import { clickHouseHealth } from '@nibleaf/clickhouse';
import { Hono } from 'hono';
import { env } from '../../env';
import { resolveEmailDelivery } from '../../processors/email-delivery';

let workerReady = false;

export const setWorkerReady = (ready: boolean): void => {
  workerReady = ready;
};

// Workbench — a modern BullMQ dashboard, mounted on the worker's Hono app at /jobs.
const workbenchAuth = env.WORKBENCH_USER && env.WORKBENCH_PASS ? { username: env.WORKBENCH_USER, password: env.WORKBENCH_PASS } : undefined;

const app = new Hono()
  .get('/health', async (ctx) => {
    const email = resolveEmailDelivery({
      postmarkApiKey: env.POSTMARK_API_KEY,
      smtpUrl: env.SMTP_URL,
      required: env.EMAIL_DELIVERY_REQUIRED,
    });
    const ready = workerReady && email.ready;
    const status = !workerReady ? 'starting' : email.ready ? 'ok' : 'degraded';

    const analytics = await clickHouseHealth();
    return ctx.json(
      {
        status,
        service: 'worker',
        email: {
          status: email.provider ? 'ok' : email.required ? 'misconfigured' : 'disabled',
          provider: email.provider ?? 'none',
          required: email.required,
        },
        analytics,
      },
      ready ? 200 : 503,
    );
  })
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
