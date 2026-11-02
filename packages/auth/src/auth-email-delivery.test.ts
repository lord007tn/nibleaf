import { betterAuth } from 'better-auth';
import { memoryAdapter } from 'better-auth/adapters/memory';
import { createAuthEndpoint } from 'better-auth/api';
import { emailOTP } from 'better-auth/plugins';
import { describe, expect, it, vi } from 'vitest';
import { requireAuthEmailEnqueue, trackRequiredAuthEmail, withRequiredAuthEmailScope } from './auth-email-delivery';

function authFixture(send: () => Promise<void>, backgroundHandler?: (task: Promise<unknown>) => void) {
  const auth = betterAuth({
    secret: 'synthetic-required-email-secret-at-least-32-characters',
    baseURL: 'http://localhost:3000',
    database: memoryAdapter({ user: [], session: [], account: [], verification: [] }),
    logger: { disabled: true },
    advanced: backgroundHandler ? { backgroundTasks: { handler: backgroundHandler } } : undefined,
    hooks: { after: requireAuthEmailEnqueue },
    plugins: [
      emailOTP({ overrideDefaultEmailVerification: true, sendVerificationOTP: (_request, context) => trackRequiredAuthEmail(context, send) }),
      {
        id: 'synthetic-optional-notification',
        endpoints: {
          optionalMail: createAuthEndpoint('/synthetic-optional-email', { method: 'POST' }, async (context) => {
            await context.context.runInBackgroundOrAwait(Promise.reject(new Error('Synthetic optional notification failure')));
            return context.json({ success: true });
          }),
        },
      },
    ],
  });
  return withRequiredAuthEmailScope(auth);
}

function request(path = '/email-otp/send-verification-otp', email = 'synthetic@example.test') {
  return new Request(`http://localhost:3000/api/auth${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: 'http://localhost:3000' },
    body: JSON.stringify({ email, type: 'sign-in' }),
  });
}

function pendingEnqueue() {
  let resolve: () => void = () => undefined;
  let reject: (error: Error) => void = () => undefined;
  const promise = new Promise<void>((fulfill, decline) => {
    resolve = fulfill;
    reject = decline;
  });
  return { promise, resolve, reject };
}

describe('required auth enqueue HTTP contract', () => {
  it('returns a retryable error when OTP enqueue rejects, rather than HTTP200 code-sent', async () => {
    const send = vi.fn().mockRejectedValue(new Error('Synthetic private queue error'));
    const response = await authFixture(send).handler(request());
    expect(send).toHaveBeenCalledOnce();
    expect(response.status).toBe(503);
    const body = await response.text();
    expect(body).toContain('AUTH_EMAIL_UNAVAILABLE');
    expect(body).not.toContain('Synthetic private queue error');
    expect(body).not.toContain('synthetic@example.test');
  });

  it('returns success after the required queue acknowledgement', async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    const response = await authFixture(send).handler(request());
    expect(send).toHaveBeenCalledOnce();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true });
  });

  it('reports a bounded enqueue timeout over the real HTTP route', async () => {
    const response = await authFixture(() => new Promise((_, reject) => setTimeout(() => reject(new Error('Synthetic queue timeout')), 10))).handler(
      request(),
    );
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ code: 'AUTH_EMAIL_UNAVAILABLE' });
  });

  it('also protects the email verification wrapper that uses Better Auth global background context', async () => {
    const send = vi.fn().mockRejectedValue(new Error('Synthetic private queue error'));
    const auth = authFixture(send);
    await (await auth.$context).internalAdapter.createUser(
      { email: 'synthetic@example.test', name: 'Synthetic', emailVerified: false },
      { method: 'email-otp' },
    );
    const response = await auth.handler(request('/send-verification-email'));
    expect(send).toHaveBeenCalledOnce();
    expect(response.status).toBe(503);
  });

  it('also rejects failed enqueue through the server API context', async () => {
    const auth = authFixture(vi.fn().mockRejectedValue(new Error('Synthetic required failure')));
    await expect(auth.api.sendVerificationOTP({ body: { email: 'synthetic@example.test', type: 'sign-in' } })).rejects.toMatchObject({
      statusCode: 503,
    });
  });

  it('rejects failed required delivery through the requestless server verification wrapper', async () => {
    const auth = authFixture(vi.fn().mockRejectedValue(new Error('Synthetic required failure')));
    await (await auth.$context).internalAdapter.createUser(
      { email: 'synthetic@example.test', name: 'Synthetic', emailVerified: false },
      { method: 'email-otp' },
    );
    await expect(auth.api.sendVerificationEmail({ body: { email: 'synthetic@example.test' } })).rejects.toMatchObject({ statusCode: 503 });
  });

  it('preserves successful delivery through the requestless server verification wrapper', async () => {
    const auth = authFixture(vi.fn().mockResolvedValue(undefined));
    await (await auth.$context).internalAdapter.createUser(
      { email: 'synthetic@example.test', name: 'Synthetic', emailVerified: false },
      { method: 'email-otp' },
    );
    await expect(auth.api.sendVerificationEmail({ body: { email: 'synthetic@example.test' } })).resolves.toEqual({ status: true });
  });

  it.each(['success-first', 'failure-first'] as const)('isolates concurrent requestless verification wrappers (%s)', async (order) => {
    const failedEnqueue = pendingEnqueue();
    const successfulEnqueue = pendingEnqueue();
    const send = vi
      .fn()
      .mockImplementationOnce(() => failedEnqueue.promise)
      .mockImplementationOnce(() => successfulEnqueue.promise);
    const auth = authFixture(send);
    const context = await auth.$context;
    for (const email of ['first@example.test', 'second@example.test']) {
      await context.internalAdapter.createUser({ email, name: 'Synthetic', emailVerified: false }, { method: 'email-otp' });
    }
    const failed = auth.api.sendVerificationEmail({ body: { email: 'first@example.test' } }).then(
      (value) => ({ value }),
      (error: unknown) => ({ error }),
    );
    await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(1));
    const successful = auth.api.sendVerificationEmail({ body: { email: 'second@example.test' } });
    await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(2));
    if (order === 'success-first') {
      successfulEnqueue.resolve();
      await expect(successful).resolves.toEqual({ status: true });
      failedEnqueue.reject(new Error('Synthetic required failure'));
      expect(await failed).toMatchObject({ error: { statusCode: 503 } });
    } else {
      failedEnqueue.reject(new Error('Synthetic required failure'));
      expect(await failed).toMatchObject({ error: { statusCode: 503 } });
      successfulEnqueue.resolve();
      await expect(successful).resolves.toEqual({ status: true });
    }
  });

  it('keeps concurrent requests isolated when only one required enqueue fails', async () => {
    const send = vi.fn().mockRejectedValueOnce(new Error('Synthetic queue error')).mockResolvedValue(undefined);
    const auth = authFixture(send);
    const responses = await Promise.all([
      auth.handler(request('/email-otp/send-verification-otp', 'first@example.test')),
      auth.handler(request('/email-otp/send-verification-otp', 'second@example.test')),
    ]);
    expect(responses.map((response) => response.status).sort()).toEqual([200, 503]);
  });

  it.each(['success-first', 'failure-first'] as const)('isolates concurrent server API calls without a Request (%s)', async (order) => {
    const failedEnqueue = pendingEnqueue();
    const successfulEnqueue = pendingEnqueue();
    const send = vi
      .fn()
      .mockImplementationOnce(() => failedEnqueue.promise)
      .mockImplementationOnce(() => successfulEnqueue.promise);
    const auth = authFixture(send);
    const failed = auth.api.sendVerificationOTP({ body: { email: 'first@example.test', type: 'sign-in' } }).then(
      (value) => ({ value }),
      (error: unknown) => ({ error }),
    );
    await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(1));
    const successful = auth.api.sendVerificationOTP({ body: { email: 'second@example.test', type: 'sign-in' } });
    await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(2));
    if (order === 'success-first') {
      successfulEnqueue.resolve();
      await expect(successful).resolves.toEqual({ success: true });
      failedEnqueue.reject(new Error('Synthetic required failure'));
      expect(await failed).toMatchObject({ error: { statusCode: 503 } });
    } else {
      failedEnqueue.reject(new Error('Synthetic required failure'));
      expect(await failed).toMatchObject({ error: { statusCode: 503 } });
      successfulEnqueue.resolve();
      await expect(successful).resolves.toEqual({ success: true });
    }
  });

  it('waits for required enqueue even when a background task handler is configured', async () => {
    const tasks: Promise<unknown>[] = [];
    const auth = authFixture(
      () => new Promise((_, reject) => setTimeout(() => reject(new Error('Synthetic queue timeout')), 10)),
      (task) => tasks.push(task),
    );
    const response = await auth.handler(request());
    expect(response.status).toBe(503);
    await Promise.all(tasks);
  });

  it('keeps unrelated optional background notifications best-effort on the same auth instance', async () => {
    const auth = authFixture(vi.fn().mockRejectedValue(new Error('Synthetic required failure')));
    await auth.handler(request());
    const response = await auth.handler(request('/synthetic-optional-email'));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true });
  });
});
