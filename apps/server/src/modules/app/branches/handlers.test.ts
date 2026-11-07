import { Hono } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const actions = vi.hoisted(() => ({ mergeBranch: vi.fn(), getMergePreview: vi.fn() }));
vi.mock('@/actions/branches', () => ({ ...actions, createBranch: vi.fn(), deleteBranch: vi.fn(), listBranches: vi.fn() }));
vi.mock('@/actions/projects', () => ({ assertProjectInOrg: vi.fn() }));
vi.mock('@/lib/hono/context', () => ({ getContextOrganizationIdOrThrow: () => 'org' }));
vi.mock('@/middlewares/guard', () => {
  const pass = async (_ctx: unknown, next: () => Promise<void>) => next();
  return {
    isAuthenticated: pass,
    requireProjectMember: () => pass,
    requireProjectRole: () => pass,
  };
});

import { AppError } from '@/errors';
import handlers from './handlers';

const app = new Hono()
  .route('/api/app/projects/:projectId/branches', handlers)
  .onError((error, ctx) => (error instanceof AppError ? ctx.json(error.toJSON(), error.status) : ctx.json({ error: String(error) }, 500)));
const merge = (init: RequestInit = {}) => app.request('/api/app/projects/p1/branches/v2/merge', { method: 'POST', ...init });
const json = (body: string) => ({ body, headers: { 'Content-Type': 'application/json' } });

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

  it.each([
    ['no body', {}],
    ['an empty object', json('{}')],
    ['an empty JSON body', json('')],
  ])('promotes with %s', async (_label, init) => {
    expect((await merge(init)).status).toBe(200);
    expect(actions.mergeBranch).toHaveBeenCalledWith('p1', 'v2', {});
  });

  it('passes the confirmation flag through', async () => {
    const confirmPreview = 'f'.repeat(64);
    expect((await merge(json(JSON.stringify({ confirmPreview })))).status).toBe(200);
    expect(actions.mergeBranch).toHaveBeenCalledWith('p1', 'v2', { confirmPreview });
  });

  it('rejects a non-boolean confirmation flag', async () => {
    const response = await merge(json('{"confirmPreview":"yes"}'));
    expect(response.status).toBe(422);
    expect(actions.mergeBranch).not.toHaveBeenCalled();
  });

  it('answers 409 branch:main_changed with the changed pages', async () => {
    actions.mergeBranch.mockRejectedValue(
      new AppError({
        code: 'branch:main_changed',
        message: 'Pages on main changed since this version was created. Review them before promoting.',
        details: changed,
      }),
    );
    const response = await merge();
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: {
        code: 'branch:main_changed',
        message: 'Pages on main changed since this version was created. Review them before promoting.',
        details: changed,
      },
    });
  });
});
