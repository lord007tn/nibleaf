import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  count: vi.fn(),
  create: vi.fn(),
  findMany: vi.fn(),
  findFirst: vi.fn(),
  createMany: vi.fn(),
}));

vi.mock('@nibleaf/database', () => ({
  prisma: {
    platformEvent: {
      count: mocks.count,
      create: mocks.create,
      findMany: mocks.findMany,
      findFirst: mocks.findFirst,
      createMany: mocks.createMany,
    },
  },
}));

import { getActivationFunnel, logFirstContentEdit, recordFirstPublishStage } from './platform-events';

describe('first-publish platform events', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.create.mockResolvedValue({ id: 'event' });
    mocks.findFirst.mockResolvedValue(null);
    mocks.createMany.mockResolvedValue({ count: 1 });
  });

  it('preserves historical edit receipts and retries after a failed write', async () => {
    mocks.findFirst.mockResolvedValueOnce({ id: 'legacy-random-id' });
    logFirstContentEdit('author', 'project');
    await vi.waitFor(() => expect(mocks.findFirst).toHaveBeenCalledOnce());
    expect(mocks.createMany).not.toHaveBeenCalled();

    mocks.createMany.mockRejectedValueOnce(new Error('temporary failure'));
    logFirstContentEdit('author', 'new-project');
    await vi.waitFor(() => expect(mocks.createMany).toHaveBeenCalledOnce());
    logFirstContentEdit('author', 'new-project');
    await vi.waitFor(() => expect(mocks.createMany).toHaveBeenCalledTimes(2));
    expect(mocks.createMany).toHaveBeenLastCalledWith({
      data: { id: 'page-edited:author:new-project', type: 'page_edited', userId: 'author', projectId: 'new-project' },
      skipDuplicates: true,
    });
  });

  it('stores no user, project, or tenant identifier', async () => {
    await recordFirstPublishStage({
      stage: 'editor_entered',
      properties: { entry_point: 'organic_content', intent: 'first_publish', source: 'mintlify_introduction' },
    });

    expect(mocks.create).toHaveBeenCalledWith({
      data: {
        type: 'editor_entered',
        userId: null,
        projectId: null,
        metadata: { entry_point: 'organic_content', intent: 'first_publish', source: 'mintlify_introduction' },
      },
    });
  });

  it('returns aggregate source journeys from identifier-free stage receipts', async () => {
    const at = (minute: number) => new Date(`2026-08-31T00:${String(minute).padStart(2, '0')}:00.000Z`);
    mocks.count.mockResolvedValue(2);
    mocks.findMany.mockImplementation(async ({ where, select }: { where: Record<string, unknown>; select: Record<string, unknown> }) => {
      const type = where.type;
      if (typeof type === 'object') {
        return [
          { type: 'first_publish_landing_viewed', metadata: { source: 'mintlify_introduction' } },
          { type: 'first_publish_cta_clicked', metadata: { source: 'mintlify_introduction' } },
          { type: 'project_entered', metadata: { source: 'mintlify_introduction' } },
          { type: 'editor_entered', metadata: { source: 'mintlify_introduction' } },
          { type: 'publish_ready', metadata: { source: 'mintlify_introduction' } },
          { type: 'editor_entered', metadata: { source: 'docker_compose_guide' } },
        ];
      }
      if (type === 'signup_completed' && 'createdAt' in select) return [{ userId: 'user-1', createdAt: at(0) }];
      if (type === 'publish_ready' && 'createdAt' in select) {
        return [
          { userId: 'user-1', createdAt: at(5) },
          { userId: 'user-2', createdAt: at(8) },
        ];
      }
      return [{ userId: 'user-1' }];
    });

    const result = await getActivationFunnel(30);

    expect(result.sourceJourneys).toEqual([
      { source: 'docker_compose_guide', landingViews: 0, ctaClicks: 0, projectEntered: 0, editorEntered: 1, ready: 0 },
      { source: 'mintlify_introduction', landingViews: 1, ctaClicks: 1, projectEntered: 1, editorEntered: 1, ready: 1 },
      { source: 'rtl_readiness_grader', landingViews: 0, ctaClicks: 0, projectEntered: 0, editorEntered: 0, ready: 0 },
    ]);
  });
});
