import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ listDeployments: vi.fn() }));
vi.mock('@/actions/branches', () => ({ listBranches: vi.fn() }));
vi.mock('@/actions/deployments', () => ({ getDeployment: vi.fn(), getPendingChanges: vi.fn(), listDeployments: mocks.listDeployments }));
vi.mock('@/actions/exports', () => ({ getExport: vi.fn(), listExports: vi.fn() }));
vi.mock('@/actions/languages', () => ({ listLanguages: vi.fn() }));
vi.mock('@/actions/pages', () => ({ getPage: vi.fn(), listPages: vi.fn() }));
vi.mock('@/actions/projects', () => ({ getProject: vi.fn() }));

import { getLatestDeploymentDto } from './dto';

const live = {
  id: 'd3',
  version: 3,
  status: 'READY',
  pagesCount: 4,
  commitMessage: null,
  error: null,
  createdAt: new Date('2026-10-30T16:00:00Z'),
  completedAt: new Date('2026-10-30T16:01:00Z'),
};

describe('latest-deployment MCP resource', () => {
  it('reads the live-only list, so failed attempts after the live publish never hide it', async () => {
    mocks.listDeployments.mockResolvedValue([live]);
    await expect(getLatestDeploymentDto('project-1')).resolves.toMatchObject({ id: 'd3', version: 3, status: 'READY' });
    expect(mocks.listDeployments).toHaveBeenCalledWith('project-1', { status: 'READY' });
  });

  it('is null when nothing ever went live', async () => {
    mocks.listDeployments.mockResolvedValue([]);
    await expect(getLatestDeploymentDto('project-1')).resolves.toBeNull();
  });
});
