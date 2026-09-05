import { beforeEach, describe, expect, it, vi } from 'vitest';

const database = vi.hoisted(() => ({ findFirst: vi.fn(), createMany: vi.fn(), create: vi.fn(), transaction: vi.fn() }));
vi.mock('@nibleaf/database', () => ({ prisma: { $transaction: database.transaction } }));

import { recordPublishReady } from './publish-activation';

const job = {
  deploymentId: 'deployment-a',
  projectId: 'project-a',
  auto: false,
  firstPublishAttribution: { entry_point: 'organic_content', intent: 'first_publish', source: 'mintlify_introduction' },
} as const;
const ready = { createdById: 'author-a', version: 2, completedAt: new Date('2026-09-01T00:00:00Z') };

describe('manual publish receipts', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    database.findFirst.mockResolvedValue(null);
    database.createMany.mockResolvedValue({ count: 1 });
    database.transaction.mockImplementation(async (run) => run({ platformEvent: database }));
  });

  it('commits canonical receipts and anonymous attribution together', async () => {
    await recordPublishReady(job, ready);
    expect(database.transaction).toHaveBeenCalledOnce();
    expect(database.createMany).toHaveBeenCalledWith({
      data: expect.objectContaining({
        id: 'publish-ready:deployment-a',
        type: 'publish_ready',
        userId: 'author-a',
        projectId: 'project-a',
        createdAt: ready.completedAt,
      }),
      skipDuplicates: true,
    });
    expect(database.create).toHaveBeenCalledExactlyOnceWith({
      data: { type: 'publish_ready', metadata: job.firstPublishAttribution, createdAt: ready.completedAt },
    });
  });

  it('preserves finite grader attribution on manual READY without adding identifiers', async () => {
    const attribution = { entry_point: 'free_tool', intent: 'first_publish', source: 'rtl_readiness_grader' } as const;
    await recordPublishReady({ ...job, firstPublishAttribution: attribution }, ready);
    expect(database.create).toHaveBeenCalledExactlyOnceWith({ data: { type: 'publish_ready', metadata: attribution, createdAt: ready.completedAt } });
  });

  it.each([true, undefined])('excludes non-explicit manual jobs (auto=%s)', async (auto) => {
    await recordPublishReady({ ...job, auto }, ready);
    expect(database.createMany).toHaveBeenCalledTimes(1);
    expect(database.create).not.toHaveBeenCalled();
  });

  it('does not attribute retries or another deployment from an already activated author/project', async () => {
    database.createMany.mockResolvedValue({ count: 0 });
    await recordPublishReady(job, ready);
    expect(database.create).not.toHaveBeenCalled();
    database.findFirst.mockResolvedValue({ id: 'historic-receipt' });
    database.createMany.mockClear();
    await recordPublishReady({ ...job, deploymentId: 'deployment-b' }, ready);
    expect(database.createMany).toHaveBeenCalledTimes(1);
    expect(database.create).not.toHaveBeenCalled();
  });

  it('marks an unattributed first publish so a later CTA cannot claim it', async () => {
    await recordPublishReady({ ...job, firstPublishAttribution: undefined }, ready);
    expect(database.createMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ type: 'first_manual_publish_ready' }) }),
    );
    expect(database.create).not.toHaveBeenCalled();
  });

  it('propagates receipt persistence failure for a retry instead of acknowledging delivery', async () => {
    database.create.mockRejectedValue(new Error('database unavailable'));
    await expect(recordPublishReady(job, ready)).rejects.toThrow('database unavailable');
  });
});
