import { randomUUID } from 'node:crypto';
import { closeQueues, getQueue, QueueNames, sendRequiredEmail } from '@nibleaf/bullmq';
import { bootWorkers, closeWorkers } from '@nibleaf/bullmq/workers';
import { betterAuth } from 'better-auth';
import { memoryAdapter } from 'better-auth/adapters/memory';
import { emailOTP } from 'better-auth/plugins';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { requireAuthEmailEnqueue, trackRequiredAuthEmail, withRequiredAuthEmailScope } from './auth-email-delivery';

describe.skipIf(process.env.QUEUE_INTEGRATION !== '1')('OTP HTTP acknowledgement through real Dragonfly', () => {
  const run = randomUUID();
  let queue: ReturnType<typeof getQueue>;
  beforeAll(() => {
    queue = getQueue(QueueNames.EMAIL);
  });
  const modes = new Map<string, 'accept' | 'reject' | 'skip'>();
  let release: () => void = () => undefined;
  let accepted: Promise<void> = Promise.resolve();
  const auth = withRequiredAuthEmailScope(
    betterAuth({
      baseURL: 'http://localhost:3000',
      secret: 'synthetic-required-provider-acceptance-secret',
      logger: { disabled: true },
      database: memoryAdapter({ user: [], session: [], account: [], verification: [] }),
      hooks: { after: requireAuthEmailEnqueue },
      plugins: [
        emailOTP({
          sendVerificationOTP: ({ email, otp }, context) =>
            trackRequiredAuthEmail(context, () => sendRequiredEmail({ to: email, subject: 'Synthetic OTP', html: `<p>${otp}</p>`, text: otp })),
        }),
      ],
    }),
  );
  const send = (label: string) => {
    const email = `${label}-${run}@example.test`;
    return auth.handler(
      new Request('http://localhost:3000/api/auth/email-otp/send-verification-otp', {
        method: 'POST',
        headers: { origin: 'http://localhost:3000', 'content-type': 'application/json' },
        body: JSON.stringify({ email, type: 'sign-in' }),
      }),
    );
  };
  const start = () =>
    bootWorkers({
      [QueueNames.EMAIL]: async (job) => {
        const mode = modes.get(job.data.to.split('-')[0] ?? '');
        if (mode === 'reject') throw new Error('Synthetic private provider rejection');
        if (mode === 'skip') return { sent: false };
        await accepted;
        return { sent: true };
      },
    });

  afterAll(async () => {
    await closeWorkers();
    const own = (await queue.getJobs(['waiting', 'completed', 'failed'], 0, 100)).filter((job) => job.data.to?.includes(run));
    for (const job of own) await job.remove();
    await closeQueues();
  });

  it('does not return HTTP success until the provider result is accepted', async () => {
    accepted = new Promise<void>((resolve) => {
      release = resolve;
    });
    await start();
    let settled = false;
    const response = send('accept').then((result) => {
      settled = true;
      return result;
    });
    await vi.waitFor(async () => expect(await queue.getActiveCount()).toBe(1));
    expect(settled).toBe(false);
    release();
    expect((await response).status).toBe(200);
  });

  it.each(['reject', 'skip'] as const)(
    'returns a privacy-safe retryable HTTP error for provider %s',
    async (mode) => {
      modes.set(mode, mode);
      const response = await send(mode);
      expect(response.status).toBe(503);
      const body = await response.text();
      expect(body).toContain('AUTH_EMAIL_UNAVAILABLE');
      expect(body).not.toContain('private');
      expect(body).not.toContain(run);
    },
    15_000,
  );

  it('returns HTTP503 rather than code-sent when no worker consumes the queued OTP', async () => {
    await closeWorkers();
    const response = await send('unconsumed');
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ code: 'AUTH_EMAIL_UNAVAILABLE' });
    expect(await queue.getWaitingCount()).toBeGreaterThan(0);
  }, 20_000);
});
