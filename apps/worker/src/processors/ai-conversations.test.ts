import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  deleted: vi.fn(),
  purge: vi.fn(),
  insert: vi.fn(),
  project: vi.fn(),
  refresh: vi.fn(),
  row: {} as Record<string, unknown>,
}));
vi.mock('../env', () => ({ env: {} }));
vi.mock('@nibleaf/database', () => ({
  prisma: { project: { findFirst: mocks.project } },
  runWithTenantAnalyticsWriteFence: async (_t: unknown, _p: unknown, _c: unknown, run: () => Promise<unknown>) => ({
    accepted: true,
    value: await run(),
  }),
}));
vi.mock('@nibleaf/bullmq/jobs/ai-conversations', async (original) => ({
  ...(await original<object>()),
  resolveAiConversationKey: () => Buffer.alloc(32),
  resolveAiConversationTransportKey: () => Buffer.alloc(32),
  openAiConversation: () => mocks.row,
}));
vi.mock('@nibleaf/clickhouse', async (original) => ({
  ...(await original<object>()),
  refreshAiUsageDaily: mocks.refresh,
  aiTurnRowSchema: { parse: (r: unknown) => r },
  aiFeedbackRowSchema: { parse: (r: unknown) => r },
  getClickHouseClient: () => ({ insert: mocks.insert }),
  isAiConversationDeleted: mocks.deleted,
  purgeAiConversation: mocks.purge,
  keys: () => ({ ANALYTICS_MODE: 'clickhouse' }),
}));

import { handleAiConversationJob } from './ai-conversations';

const job = { kind: 'ai-conversation-turn', tenantId: 'tenant', projectId: 'project', sealed: 'test' };
beforeEach(() => {
  vi.clearAllMocks();
  mocks.project.mockResolvedValue({ id: 'project' });
  mocks.row = { tenant_id: 'tenant', project_id: 'project', conversation_id: 'c', expires_at: '2099-01-01T00:00:00.000Z' };
  mocks.deleted.mockResolvedValue(false);
});
describe('archive worker', () => {
  it('drops expired records', async () => {
    mocks.row.expires_at = '2000-01-01T00:00:00.000Z';
    expect(await handleAiConversationJob(job)).toEqual({ inserted: 0 });
    expect(mocks.insert).not.toHaveBeenCalled();
  });
  it('purges a tombstoned retry before insertion', async () => {
    mocks.deleted.mockResolvedValue(true);
    expect(await handleAiConversationJob(job)).toEqual({ inserted: 0 });
    expect(mocks.purge).toHaveBeenCalledOnce();
    expect(mocks.insert).not.toHaveBeenCalled();
  });
  it('rechecks after insertion and purges a racing deletion', async () => {
    mocks.deleted.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    expect(await handleAiConversationJob(job)).toEqual({ inserted: 0 });
    expect(mocks.insert).toHaveBeenCalledOnce();
    expect(mocks.deleted).toHaveBeenCalledTimes(2);
    expect(mocks.purge).toHaveBeenCalledOnce();
  });
  it('rethrows only a fixed phase', async () => {
    mocks.insert.mockRejectedValueOnce(new Error('private question'));
    await expect(handleAiConversationJob(job)).rejects.toThrow('ai conversation insert failed');
  });
  it('rejects scope substitution and deleted projects', async () => {
    mocks.row.tenant_id = 'other';
    await expect(handleAiConversationJob(job)).rejects.toThrow('ai conversation open failed');
    mocks.row.tenant_id = 'tenant';
    mocks.project.mockResolvedValue(null);
    expect(await handleAiConversationJob(job)).toEqual({ inserted: 0 });
    expect(mocks.insert).not.toHaveBeenCalled();
  });
});

it('refreshes the turn UTC day after a durable insert', async () => {
  mocks.row.occurred_at = '2026-11-01T23:00:00.000Z';
  expect(await handleAiConversationJob(job)).toEqual({ inserted: 1 });
  expect(mocks.refresh).toHaveBeenCalledWith({ tenantId: 'tenant', projectId: 'project' }, ['2026-11-01'], expect.anything());
});
