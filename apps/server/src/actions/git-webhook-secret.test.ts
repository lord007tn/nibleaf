import { beforeEach, describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => {
  const client = {
    projectGitWebhookSecret: { findUnique: vi.fn(), upsert: vi.fn() },
    organizationGitWebhookSecret: { upsert: vi.fn() },
    $queryRaw: vi.fn(),
    $transaction: vi.fn(),
  };
  return client;
});
vi.mock('@nibleaf/database', () => ({ prisma: db }));

import { getGitWebhookSecret, readGitWebhookSecret, rotateGitWebhookSecret } from './git-webhook-secret';

describe('website webhook secret', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    db.projectGitWebhookSecret.findUnique.mockResolvedValue({ secret: 'exact-original-secret' });
    db.$queryRaw.mockResolvedValue([{ organizationId: 'destination-org' }]);
    db.$transaction.mockImplementation((run) => run(db));
  });
  it('reads the website secret without following its organization or mutating it', async () => {
    expect(await getGitWebhookSecret('website-a')).toBe('exact-original-secret');
    expect(await readGitWebhookSecret('website-a')).toEqual({ projectId: 'website-a', secret: 'exact-original-secret' });
    expect(db.projectGitWebhookSecret.findUnique).toHaveBeenCalledWith({ where: { projectId: 'website-a' }, select: { secret: true } });
    expect(db.$transaction).not.toHaveBeenCalled();
  });
  it('dual-writes explicit rotation to the website and legacy organization table', async () => {
    const secret = await rotateGitWebhookSecret('website-a');
    expect(secret).toMatch(/^[a-f0-9]{64}$/u);
    expect(db.projectGitWebhookSecret.upsert).toHaveBeenCalledWith({
      where: { projectId: 'website-a' },
      create: { projectId: 'website-a', secret },
      update: { secret },
    });
    expect(db.organizationGitWebhookSecret.upsert).toHaveBeenCalledWith({
      where: { organizationId: 'destination-org' },
      create: { organizationId: 'destination-org', secret },
      update: { secret },
    });
  });
});
