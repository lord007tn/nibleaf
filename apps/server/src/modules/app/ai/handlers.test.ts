import { Hono } from 'hono';
import { contextStorage } from 'hono/context-storage';
import { generateSpecs } from 'hono-openapi';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppError } from '@/errors';
import type { HonoEnv } from '@/lib/hono/context';

const mocks = vi.hoisted(() => ({
  role: 'member' as string | null,
  capability: vi.fn(),
  resolve: vi.fn(),
  draft: vi.fn(),
  quota: vi.fn(),
  track: vi.fn(),
  assertProject: vi.fn(),
}));
vi.mock('@nibleaf/database', () => ({ prisma: { user: { findUnique: async () => ({ suspendedAt: null }) } } }));
vi.mock('@/actions/projects', () => ({
  assertProjectAccess: async () => {
    if (!mocks.role) throw new AppError({ code: 'database:not_found' });
    return { project: { id: 'site', organizationId: 'site-org' }, organizationId: 'site-org', role: mocks.role };
  },
  assertProjectInOrg: mocks.assertProject,
}));
vi.mock('@/actions/ai', () => ({ getAiDraftCapability: mocks.capability, resolveAiDraft: mocks.resolve, draftContentWithTelemetry: mocks.draft }));
vi.mock('@/actions/analytics', () => ({ trackProjectEvent: mocks.track }));
vi.mock('@/lib/ai-quota', () => ({ assertAiQuota: mocks.quota }));

import handlers from './handlers';

const appFor = (auth = true) => {
  const app = new Hono<HonoEnv>();
  app.use('*', contextStorage());
  app.use('*', async (c, next) => {
    c.set('user', auth ? { id: 'user', name: 'User', email: 'user@example.com' } : null);
    c.set('organizationId', 'unrelated-session-org');
    c.set('membership', null);
    await next();
  });
  app.onError((e, c) => (e instanceof AppError ? c.json(e.toJSON(), e.status) : c.json({ error: 'failed' }, 500)));
  app.route('/api/app/projects/:projectId/ai', handlers);
  return app;
};
const base = '/api/app/projects/site/ai';
const post = () => ({
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ mode: 'rephrase', content: 'Fictional draft' }),
});
const runtime = { source: 'workspace', providerId: 'openai', answerModel: 'site-model', apiKey: 'site-secret' };
beforeEach(() => {
  vi.clearAllMocks();
  mocks.role = 'member';
  mocks.capability.mockResolvedValue({ available: true, source: 'workspace', provider: 'openai', reason: null });
  mocks.resolve.mockResolvedValue({ runtime, reason: null });
  mocks.draft.mockResolvedValue({
    text: 'Improved.',
    source: 'workspace',
    provider: 'openai',
    model: 'site-model',
    latencyMs: 1,
    promptTokens: 2,
    completionTokens: 1,
  });
  mocks.quota.mockResolvedValue(undefined);
  mocks.track.mockResolvedValue(undefined);
});
describe('draft and capability access', () => {
  it('documents capability reads independently from drafting', async () => {
    const specification = await generateSpecs(appFor());
    const operation = specification.paths['/api/app/projects/{projectId}/ai/draft-capability']?.get;
    expect(operation?.description).toBe(
      'Read editor AI drafting availability, connection source, provider, and quota state without consuming a request.',
    );
    expect(operation?.tags).toEqual(['ai']);
  });
  it.each(['capability', 'draft'])('requires authentication and Editor membership for %s', async (endpoint) => {
    const path = endpoint === 'capability' ? `${base}/draft-capability` : base;
    const init = endpoint === 'draft' ? post() : undefined;
    expect((await appFor(false).request(path, init)).status).toBe(401);
    mocks.role = null;
    expect((await appFor().request(path, init)).status).toBe(404);
    mocks.role = 'viewer';
    expect((await appFor().request(path, init)).status).toBe(403);
    expect(mocks.capability).not.toHaveBeenCalled();
    expect(mocks.resolve).not.toHaveBeenCalled();
  });
  it.each(['member', 'admin', 'owner'])('allows %s capability reads scoped to the project organization', async (role) => {
    mocks.role = role;
    const response = await appFor().request(`${base}/draft-capability`);
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(await response.json()).toEqual({ data: { available: true, source: 'workspace', provider: 'openai', reason: null } });
    expect(mocks.capability).toHaveBeenCalledWith('site', 'site-org');
    expect(mocks.assertProject).toHaveBeenCalledWith('site-org', 'site');
    expect(mocks.quota).not.toHaveBeenCalled();
    expect(mocks.draft).not.toHaveBeenCalled();
  });
});
describe('draft request execution', () => {
  it('consumes one quota request, uses the resolved runtime and records provider/source', async () => {
    const response = await appFor().request(base, post());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ data: { text: 'Improved.' } });
    expect(mocks.quota).toHaveBeenCalledExactlyOnceWith('site-org');
    expect(mocks.draft).toHaveBeenCalledWith({ mode: 'rephrase', content: 'Fictional draft' }, runtime);
    expect(mocks.track).toHaveBeenNthCalledWith(
      1,
      'site',
      { name: 'answer_started', provider: 'openai', model: 'site-model', connectionSource: 'workspace' },
      { source: 'dashboard' },
    );
    expect(mocks.track).toHaveBeenNthCalledWith(
      2,
      'site',
      expect.objectContaining({ name: 'answer_completed', provider: 'openai', connectionSource: 'workspace' }),
      { source: 'dashboard' },
    );
    expect(JSON.stringify(mocks.track.mock.calls)).not.toContain('secret');
  });
  it.each([
    ['not_configured', 503],
    ['site_disabled', 403],
    ['instance_disabled', 403],
  ] as const)('returns an AI-specific code for %s without consuming quota', async (reason, status) => {
    mocks.resolve.mockResolvedValue({ runtime: null, reason });
    const response = await appFor().request(base, post());
    expect(response.status).toBe(status);
    expect(await response.json()).toEqual({
      error: {
        code: reason === 'not_configured' ? 'ai:not_configured' : 'ai:disabled',
        message: reason === 'not_configured' ? 'ai:not_configured' : 'ai:disabled',
        details: { reason },
      },
    });
    expect(mocks.quota).not.toHaveBeenCalled();
    expect(mocks.draft).not.toHaveBeenCalled();
  });
  it.each([
    ['http:rate_limited', 429],
    ['usage:unavailable', 503],
  ] as const)('preserves quota rejection %s and never calls the provider', async (code, status) => {
    mocks.quota.mockRejectedValue(new AppError({ code }));
    expect((await appFor().request(base, post())).status).toBe(status);
    expect(mocks.draft).not.toHaveBeenCalled();
    expect(mocks.track).not.toHaveBeenCalled();
  });
  it('keeps started, completed and failed events for a 180-character workspace model', async () => {
    const longModel = `openrouter/${'m'.repeat(169)}`;
    expect(longModel).toHaveLength(180);
    const { analyticsPayloadSchema } = await import('@nibleaf/clickhouse');
    mocks.resolve.mockResolvedValue({ runtime: { ...runtime, answerModel: longModel }, reason: null });
    mocks.draft.mockResolvedValueOnce({ text: 'Improved.', source: 'workspace', provider: 'openai', model: longModel, latencyMs: 1 });
    expect((await appFor().request(base, post())).status).toBe(200);
    mocks.draft.mockRejectedValueOnce(new Error('upstream'));
    expect((await appFor().request(base, post())).status).toBe(502);
    const payloads = mocks.track.mock.calls.map(([, payload]) => payload);
    expect(payloads.map((payload) => payload.name)).toEqual(['answer_started', 'answer_completed', 'answer_started', 'answer_failed']);
    for (const payload of payloads) {
      expect(payload.model).toBe(longModel.slice(0, 120));
      expect(analyticsPayloadSchema.safeParse(payload).success).toBe(true);
    }
  });
  it('records failures using the actual provider and connection source', async () => {
    mocks.draft.mockRejectedValue(new Error('upstream site-secret'));
    const response = await appFor().request(base, post());
    expect(response.status).toBe(502);
    expect(JSON.stringify(await response.json())).not.toContain('site-secret');
    expect(mocks.track).toHaveBeenLastCalledWith(
      'site',
      expect.objectContaining({ name: 'answer_failed', provider: 'openai', model: 'site-model', connectionSource: 'workspace' }),
      { source: 'dashboard' },
    );
    expect(JSON.stringify(mocks.track.mock.calls)).not.toContain('secret');
  });
});
