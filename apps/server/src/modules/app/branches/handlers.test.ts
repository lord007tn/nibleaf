import { Hono } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const actions = vi.hoisted(() => ({ mergeBranch: vi.fn(), getMergePreview: vi.fn() }));
vi.mock('@/actions/branches', () => ({ ...actions, createBranch: vi.fn(), deleteBranch: vi.fn(), listBranches: vi.fn() }));
vi.mock('@/actions/projects', () => ({ assertProjectInOrg: vi.fn() }));
vi.mock('@/lib/hono/context', () => ({ getContextOrganizationIdOrThrow: () => 'org' }));
vi.mock('@/middlewares/guard', () => {
  const pass = async (_ctx: unknown, next: () => Promise<void>) => next();
  return { isAuthenticated: pass, requireProjectMember: () => pass, requireProjectRole: () => pass };
});

import { AppError } from '@/errors';
import handlers from './handlers';

const app = new Hono()
  .route('/api/app/projects/:projectId/branches', handlers)
  .onError((error, ctx) => (error instanceof AppError ? ctx.json(error.toJSON(), error.status) : ctx.json({ error: String(error) }, 500)));
const merge = () => app.request('/api/app/projects/p1/branches/v2/merge', { method: 'POST' });

const changed = {
  changedOnMainSinceFork: [
    { pageId: 'billing', title: 'Billing', path: 'billing', languageCode: 'en', change: 'modified', updatedAt: '2026-11-02T10:00:00.000Z' },
  ],
  baselineComplete: true,
};

beforeEach(() => {
  actions.mergeBranch.mockReset().mockResolvedValue({ id: 'main' });
  actions.getMergePreview.mockReset().mockResolvedValue(changed);
});

describe('branch promote routes', () => {
  it('serves the merge preview', async () => {
    const response = await app.request('/api/app/projects/p1/branches/v2/merge-preview');
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ data: changed });
    expect(actions.getMergePreview).toHaveBeenCalledWith('p1', 'v2');
  });

  it('promotes with no body', async () => {
    expect((await merge()).status).toBe(200);
    expect(actions.mergeBranch).toHaveBeenCalledWith('p1', 'v2');
  });

  it.each([
    ['branch:main_changed', { reason: 'main_changed', changedOnMainSinceFork: changed.changedOnMainSinceFork }],
    ['branch:baseline_missing', { since: '2026-10-01T00:00:00.000Z', mainPagesEditedOrCreatedSince: 4 }],
  ] as const)('answers 409 %s with its details', async (code, details) => {
    actions.mergeBranch.mockRejectedValue(new AppError({ code, message: 'Not promoted.', details }));
    const response = await merge();
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: { code, message: 'Not promoted.', details } });
  });
});
