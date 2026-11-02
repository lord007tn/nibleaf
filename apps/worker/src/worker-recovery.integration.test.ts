import { type ChildProcess, fork } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { connect, createServer, type Socket } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { closeQueueEvents, closeQueues, getQueue, QueueNames, sendRequiredEmail } from '@nibleaf/bullmq';
import { afterAll, describe, expect, it } from 'vitest';

const children: ChildProcess[] = [];
const fixture = fileURLToPath(new URL('./fixtures/worker-recovery.ts', import.meta.url));

function message(child: ChildProcess, event: string): Promise<{ event: string; health: Array<{ ready: boolean; reason: string }> }> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      child.off('message', receive);
      reject(new Error(`Fixture did not report ${event}`));
    }, 10_000);
    const receive = (value: unknown) => {
      if (value && typeof value === 'object' && 'event' in value && value.event === event) {
        clearTimeout(timer);
        child.off('message', receive);
        resolve(value as { event: string; health: Array<{ ready: boolean; reason: string }> });
      }
    };
    child.on('message', receive);
  });
}

describe.skipIf(process.env.QUEUE_INTEGRATION !== '1')('real Dragonfly consumer recovery', () => {
  afterAll(async () => {
    for (const child of children) {
      if (child.exitCode !== null || child.signalCode !== null) continue;
      const exit = once(child, 'exit');
      child.send('shutdown');
      const kill = setTimeout(() => child.kill(), 3000);
      await exit;
      clearTimeout(kill);
    }
    await Promise.all([closeQueues(), closeQueueEvents()]);
  });

  it('alerts outside the broken queue, exits nonzero, and delivers retained work after supervisor restart', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'nibleaf-queue-recovery-'));
    const run = randomUUID();
    // Interrupt only this child's real TCP connections. Producers, other tests,
    // and every other project keep using the shared server directly.
    const sockets = new Set<Socket>();
    const proxy = createServer((socket) => {
      const upstream = connect(Number(process.env.REDIS_PORT ?? 6379), process.env.REDIS_HOST ?? '127.0.0.1');
      sockets.add(socket);
      sockets.add(upstream);
      socket.pipe(upstream);
      upstream.pipe(socket);
      socket.on('error', () => upstream.destroy());
      upstream.on('error', () => socket.destroy());
      socket.on('close', () => {
        sockets.delete(socket);
        upstream.destroy();
      });
      upstream.on('close', () => {
        sockets.delete(upstream);
        socket.destroy();
      });
    });
    proxy.listen(0, '127.0.0.1');
    await once(proxy, 'listening');
    const address = proxy.address();
    if (!address || typeof address === 'string') throw new Error('Expected a TCP fixture address.');
    let output = '';
    const start = (port = process.env.REDIS_PORT) => {
      const child = fork(fixture, [], {
        execArgv: ['--import', 'tsx'],
        silent: true,
        env: {
          ...process.env,
          REDIS_PORT: port,
          NODE_ENV: 'production',
          WORKER_QUEUES: 'email',
          POSTMARK_API_KEY: '',
          SMTP_URL: 'smtp://127.0.0.1:1025',
          WORKER_ALERT_EMAIL: `operator-${run}@example.test`,
          NIBLEAF_RECOVERY_TEST_STATE: join(directory, 'alert.json'),
        },
      });
      children.push(child);
      child.stdout?.on('data', (data) => {
        output += String(data);
      });
      child.stderr?.on('data', (data) => {
        output += String(data);
      });
      return child;
    };
    const queue = getQueue(QueueNames.EMAIL);
    const first = start(String(address.port));
    let jobId: string | undefined;
    try {
      expect((await message(first, 'ready')).health.every((worker) => worker.ready)).toBe(true);
      const exited = once(first, 'exit');
      const closed = new Promise<void>((resolve) => proxy.close(() => resolve()));
      for (const socket of sockets) socket.destroy();
      await closed;
      const job = await queue.add(
        'send-email',
        { to: `recipient-${run}@example.test`, subject: 'Synthetic recovery verification', html: '<p>Synthetic</p>', text: 'Synthetic' },
        { jobId: `recovery-${run}` },
      );
      jobId = job.id;
      const [code] = await Promise.race([exited, new Promise<never>((_, reject) => setTimeout(() => reject(new Error(output)), 12_000).unref())]);
      expect(code, output).toBe(1);
      expect(output).toContain('worker_recovery_restart');
      expect(output).toContain('client-not-ready');
      expect(output).toContain('worker_alert_sent');
      expect(await job.getState()).toBe('waiting');
      const replacement = start();
      expect((await message(replacement, 'ready')).health.every((worker) => worker.ready)).toBe(true);
      const { waitForEmailDelivery } = await import('../../../packages/bullmq/src/queues/email-delivery');
      await waitForEmailDelivery(queue, jobId as string);
      expect((await queue.getJob(jobId as string))?.returnvalue).toEqual({ sent: true });
      await sendRequiredEmail({
        to: `recipient-${run}@example.test`,
        subject: 'Synthetic post-recovery verification',
        html: '<p>Synthetic</p>',
        text: 'Synthetic',
      });
    } finally {
      for (const socket of sockets) socket.destroy();
      if (proxy.listening) proxy.close();
      if (jobId) await (await queue.getJob(jobId))?.remove();
      // Only the named synthetic jobs in this disposable namespace are eligible.
      const own = (await queue.getJobs(['completed', 'failed', 'waiting'], 0, 100)).filter((job) => job.data.to === `recipient-${run}@example.test`);
      for (const job of own) await job.remove();
      await rm(directory, { recursive: true, force: true });
    }
  }, 30_000);
});
