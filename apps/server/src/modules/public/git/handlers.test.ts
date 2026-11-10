import { createHmac } from 'node:crypto';
import { Hono } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppError } from '@/errors';
import type { HonoEnv } from '@/lib/hono/context';

const mocks = vi.hoisted(() => ({
  organization: vi.fn(),
  organizationUpdate: vi.fn(),
  secretFind: vi.fn(),
  secretUpsert: vi.fn(),
  stripCopy: vi.fn(),
}));
vi.mock('@nibleaf/database', () => {
  const prisma = {
    gitConnection: { findUnique: vi.fn(async () => null) },
    project: { findUnique: vi.fn(async () => ({ organizationId: 'destination-org' })) },
    projectGitSettings: { findUnique: vi.fn(async () => ({ settings: { repo: 'acme/docs' } })) },
    organization: { findUnique: mocks.organization, update: mocks.organizationUpdate, updateMany: mocks.stripCopy },
    projectGitWebhookSecret: { findUnique: mocks.secretFind, upsert: mocks.secretUpsert },
    $transaction: async (run: (tx: unknown) => Promise<unknown>) => run(prisma),
  };
  return { Prisma: { PrismaClientKnownRequestError: class extends Error {} }, prisma };
});
vi.mock('@nibleaf/bullmq', () => ({ createJob: vi.fn(), QueueNames: { PUBLISH: 'publish' } }));
vi.mock('@/actions/git/workflow', () => ({
  getConnectionWebhookSecret: vi.fn(),
  getReadyGitPreview: vi.fn(),
  processGitOperation: vi.fn(),
  queueGitOperation: vi.fn(),
  recordWebhookDelivery: vi.fn(),
}));
vi.mock('@/actions/git-import', () => ({ importFromGitProvider: vi.fn() }));
vi.mock('@/env', () => ({ env: {} }));

import handlers from './handlers';

const app = new Hono<HonoEnv>();
app.onError((error, ctx) => (error instanceof AppError ? ctx.json(error.toJSON(), error.status) : ctx.json({ error: error.message }, 500)));
app.route('/git', handlers);

const ping = (secret: string) => {
  const body = JSON.stringify({ zen: 'synthetic' });
  return app.request('/git/webhook/project-1', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-github-event': 'ping',
      'x-hub-signature-256': `sha256=${createHmac('sha256', secret).update(body, 'utf8').digest('hex')}`,
    },
    body,
  });
};

describe('legacy one-way Git webhook', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.organizationUpdate.mockResolvedValue({});
    mocks.secretUpsert.mockImplementation(async ({ create }: { create: { secret: string } }) => ({ secret: create.secret }));
    mocks.stripCopy.mockResolvedValue({ count: 1 });
    mocks.organization.mockResolvedValue({ metadata: JSON.stringify({ git: { repo: 'acme/docs', webhookSecret: 'metadata-secret' } }) });
  });

  it('verifies deliveries with the server-side secret', async () => {
    mocks.secretFind.mockResolvedValue({ secret: 'stored-secret' });
    expect((await ping('metadata-secret')).status).toBe(401);
    expect(mocks.stripCopy).not.toHaveBeenCalled();
    expect((await ping('stored-secret')).status).toBe(200);
  });

  it('writes nothing for a delivery that fails verification', async () => {
    mocks.secretFind.mockResolvedValue({ secret: 'stored-secret' });
    expect((await ping('forged-secret')).status).toBe(401);
    expect(mocks.secretUpsert).not.toHaveBeenCalled();
    expect(mocks.stripCopy).not.toHaveBeenCalled();
    expect(mocks.organizationUpdate).not.toHaveBeenCalled();
  });

  it('requires the migrated website secret, even when the org has a legacy copy', async () => {
    mocks.secretFind.mockResolvedValue(null);
    expect((await ping('metadata-secret')).status).toBe(401);
    expect(mocks.secretUpsert).not.toHaveBeenCalled();
    expect(mocks.organizationUpdate).not.toHaveBeenCalled();
  });
});
