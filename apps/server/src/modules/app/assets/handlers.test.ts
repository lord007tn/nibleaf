import { Hono } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const actions = vi.hoisted(() => ({ deleteAsset: vi.fn(), uploadAsset: vi.fn() }));
vi.mock('@/actions/assets', () => ({ ...actions, confirmAsset: vi.fn(), listAssets: vi.fn(), presignAsset: vi.fn() }));
vi.mock('@/actions/projects', () => ({ assertProjectInOrg: vi.fn() }));
vi.mock('@/lib/hono/context', () => ({ getContextOrganizationIdOrThrow: () => 'org', getContextUserOrThrow: () => ({ id: 'user' }) }));
vi.mock('@/middlewares/guard', async () => {
  const { AppError } = await import('@/errors');
  const pass = async (_ctx: unknown, next: () => Promise<void>) => next();
  return {
    isAuthenticated: pass,
    requireProjectMember: () => pass,
    // A request marked as a Viewer stands for anyone below the role a route asks for.
    requireProjectRole: (role: string) => async (ctx: { req: { header: (name: string) => string | undefined } }, next: () => Promise<void>) => {
      if (ctx.req.header('x-test-role') === 'viewer') throw new AppError({ code: 'auth:insufficient_role', message: `Needs ${role}` });
      return next();
    },
  };
});

import { AppError } from '@/errors';
import handlers from './handlers';

const app = new Hono()
  .route('/api/app/projects/:projectId/assets', handlers)
  .onError((error, ctx) => (error instanceof AppError ? ctx.json(error.toJSON(), error.status) : ctx.json({ error: String(error) }, 500)));
const remove = (headers: Record<string, string> = {}) => app.request('/api/app/projects/p1/assets/a1', { method: 'DELETE', headers });

beforeEach(() => {
  actions.deleteAsset.mockReset().mockResolvedValue({ id: 'a1' });
  actions.uploadAsset.mockReset().mockResolvedValue(undefined);
});

it('uses the same editor guard for API uploads and rejects viewers before consuming the body', async () => {
  const path = '/api/app/projects/p1/assets/upload/token';
  expect((await app.request(path, { method: 'PUT', body: 'abc', headers: { 'x-test-role': 'viewer' } })).status).toBe(403);
  expect(actions.uploadAsset).not.toHaveBeenCalled();
  expect((await app.request(path, { method: 'PUT', body: 'abc' })).status).toBe(204);
  expect(actions.uploadAsset).toHaveBeenCalledWith('org', 'p1', 'token', expect.any(Request));
});

describe('asset delete route', () => {
  it('deletes one asset of the project for an editor', async () => {
    const response = await remove();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ data: { id: 'a1' } });
    expect(actions.deleteAsset).toHaveBeenCalledWith('org', 'p1', 'a1');
  });

  it('is limited to members who can edit the project', async () => {
    expect((await remove({ 'x-test-role': 'viewer' })).status).toBe(403);
    expect(actions.deleteAsset).not.toHaveBeenCalled();
  });

  it('answers 409 asset:in_use when saved content still uses the file', async () => {
    actions.deleteAsset.mockRejectedValue(new AppError({ code: 'asset:in_use', message: 'kept' }));
    const response = await remove();
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: { code: 'asset:in_use' } });
  });
});
