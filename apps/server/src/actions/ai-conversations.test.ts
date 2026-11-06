import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ mode: 'clickhouse', list: vi.fn(), detail: vi.fn(), project: vi.fn() }));
vi.mock('./projects', () => ({ assertProjectInOrg: mocks.project }));
vi.mock('@/lib/ai-search/conversation-archive', () => ({ aiConversationCaptureReady: () => true }));
vi.mock('@nibleaf/clickhouse', async (original) => ({
  ...(await original<object>()),
  keys: () => ({ ANALYTICS_MODE: mocks.mode }),
  queryAiConversations: mocks.list,
  queryAiConversation: mocks.detail,
}));

import { getProjectAiConversation, listProjectAiConversations } from './ai-conversations';

beforeEach(() => {
  vi.clearAllMocks();
  mocks.mode = 'clickhouse';
  mocks.project.mockResolvedValue({ config: { search: { aiConversationCapture: false } } });
  mocks.list.mockResolvedValue({ items: [], nextCursor: null });
  mocks.detail.mockResolvedValue(null);
});
describe('conversation actions', () => {
  it('reports disabled storage and respects project capture settings', async () => {
    mocks.mode = 'disabled';
    expect(await listProjectAiConversations('o', 'p', { range: '30d', limit: 25 })).toEqual({
      availability: 'disabled',
      captureEnabled: false,
      items: [],
      nextCursor: null,
    });
    expect(mocks.list).not.toHaveBeenCalled();
  });
  it('reports storage failures as unavailable', async () => {
    mocks.list.mockRejectedValue(new Error('private content'));
    expect((await listProjectAiConversations('o', 'p', { range: '30d', limit: 25 })).availability).toBe('unavailable');
  });
  it('returns 404 only for genuinely absent detail', async () => {
    await expect(getProjectAiConversation('o', 'p', 'c')).rejects.toMatchObject({ status: 404 });
    mocks.detail.mockRejectedValue(new Error('storage'));
    await expect(getProjectAiConversation('o', 'p', 'c')).rejects.toMatchObject({ status: 502 });
  });
  it('enforces project tenancy before reading', async () => {
    mocks.project.mockRejectedValue(new Error('forbidden'));
    await expect(listProjectAiConversations('other', 'p', { range: '30d', limit: 25 })).rejects.toThrow('forbidden');
    expect(mocks.list).not.toHaveBeenCalled();
  });
});
