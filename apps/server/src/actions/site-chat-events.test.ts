import { beforeEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ context: vi.fn(), project: vi.fn(), record: vi.fn() }));
vi.mock('@/actions/sites', () => ({ resolvePublishedAnswerContext: mocks.context }));
vi.mock('@/actions/site-chat', () => ({
  trustedChatConsent: (_config: unknown, consent: string) => (consent === 'not_required' ? 'unknown' : consent),
}));
vi.mock('@nibleaf/database', () => ({ prisma: { project: { findUnique: mocks.project } } }));
vi.mock('@/lib/ai-search/conversation-archive', () => ({ recordAiChatEvents: mocks.record }));

import { recordSiteChatEvents } from './site-chat-events';

const body = { consent: 'not_required', events: [{ name: 'new_chat', conversationId: '00000000-0000-4000-8000-000000000001' }] } as const;
beforeEach(() => {
  vi.clearAllMocks();
  mocks.context.mockResolvedValue({ scope: { projectId: 'resolved', language: 'ar', visibility: 'public' }, snapshot: { project: { config: {} } } });
  mocks.project.mockResolvedValue({ organizationId: 'tenant' });
});
it('derives scope and downgrades untrusted consent', async () => {
  expect(await recordSiteChatEvents('slug', { ...body, events: [...body.events] })).toEqual({ recorded: 1 });
  expect(mocks.record).toHaveBeenCalledWith(expect.objectContaining({ projectId: 'resolved', tenantId: 'tenant', consent: 'unknown' }), body.events);
});
it('keeps private-site events private for readers who may read the site', async () => {
  mocks.context.mockResolvedValueOnce({
    scope: { projectId: 'resolved', language: 'en', visibility: 'private' },
    snapshot: { project: { config: {} } },
  });
  await recordSiteChatEvents('private', { ...body, events: [...body.events] });
  expect(mocks.record).toHaveBeenCalledWith(expect.objectContaining({ visibility: 'private' }), body.events);
});
it('rejects sites the reader cannot open before capture', async () => {
  mocks.context.mockRejectedValueOnce(new Error('not found'));
  await expect(recordSiteChatEvents('unknown', { ...body, events: [...body.events] })).rejects.toThrow('not found');
});
