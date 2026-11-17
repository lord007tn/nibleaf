// @vitest-environment jsdom
// Real settings query and PATCH mutation on the product QueryClient; only HTTP is replaced.
// Legacy-shaped HTTP answers are compatibility cases, not manually injected cache entries.
import { dehydrate, onlineManager, QueryClientProvider } from '@tanstack/react-query';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ get: vi.fn(), patch: vi.fn() }));
vi.mock('@/services/api', () => {
  const node = (path: string[]): unknown =>
    new Proxy(() => undefined, {
      get: (_target, key) => (typeof key === 'string' && key !== 'then' ? node([...path, key]) : undefined),
      apply: () => (path.at(-1) === '$get' ? mocks.get() : mocks.patch()),
    });
  return { api: node([]) };
});

import { useWriteGitSettings } from '@/features/site-git/api/git-connection';
import { createQueryClient } from '@/integrations/tanstack-query/query-client';
import { ApiResponseError } from './client-helpers';
import { workspaceSettingsQueryOptions } from './query-options';

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
const SECRET = 'fictional-settings-secret-855';
const answer = {
  plan: 'free',
  notifications: { joined: false },
  integrations: {},
  git: { connected: false, autoPublish: false, webhookSecret: SECRET },
  name: 'Fixture',
  slug: null,
  projectCount: 1,
  memberCount: 1,
};
let client: ReturnType<typeof createQueryClient>;
let root: ReturnType<typeof createRoot> | undefined;
// Include non-enumerable Error fields, options/state, Map/Set entries and cycles.
const graph = (value: unknown, seen = new Set<unknown>()): string => {
  if (typeof value === 'string') return value;
  if (!value || (typeof value !== 'object' && typeof value !== 'function') || seen.has(value)) return '';
  seen.add(value);
  const entries = value instanceof Map ? [...value.entries()].flat() : value instanceof Set ? [...value] : [];
  return [
    ...entries,
    ...Reflect.ownKeys(value).flatMap((key) => {
      const property = Object.getOwnPropertyDescriptor(value, key);
      return property && 'value' in property ? [property.value] : [];
    }),
  ]
    .map((item) => graph(item, seen))
    .join('\n');
};
const expectSafe = () => {
  for (const value of [
    client.getQueryCache().getAll(),
    client.getMutationCache().getAll(),
    dehydrate(client),
    dehydrate(client, { shouldDehydrateQuery: () => true, shouldDehydrateMutation: () => true }),
  ])
    expect(graph(value)).not.toContain(SECRET);
};
beforeEach(() => {
  onlineManager.setOnline(true);
  client = createQueryClient();
  mocks.get.mockReset().mockImplementation(async () => Response.json({ data: answer }));
  mocks.patch.mockReset().mockImplementation(async () => Response.json({ data: answer }));
});
afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  root = undefined;
  client.clear();
  onlineManager.setOnline(true);
});

it.each(['site-a', undefined])('projects legacy GET before caching or default/all dehydration: %s', async (site) => {
  const data = await client.fetchQuery(workspaceSettingsQueryOptions(site));
  expect(data.git).not.toHaveProperty('webhookSecret');
  expect(data.git).toMatchObject({ connected: false, autoPublish: false, webhookConfigured: true });
  expect(data.slug).toBeNull();
  expect(data.notifications).toEqual({ joined: false });
  expectSafe();
});

it('honors an explicit configured=false while still dropping an older raw-config secret copy', async () => {
  mocks.get.mockImplementation(async () => Response.json({ data: { ...answer, git: { ...answer.git, webhookConfigured: false } } }));
  expect((await client.fetchQuery(workspaceSettingsQueryOptions('site-a'))).git.webhookConfigured).toBe(false);
  expectSafe();
});

it('projects a legacy PATCH answer before mutation data can retain it', async () => {
  let answerPatch: (response: Response) => void = () => undefined;
  mocks.patch.mockImplementation(
    () =>
      new Promise((resolve) => {
        answerPatch = resolve;
      }),
  );
  let write: ReturnType<typeof useWriteGitSettings>['write'] = () => undefined;
  function Probe() {
    write = useWriteGitSettings('site-a').write;
    return null;
  }
  root = createRoot(document.createElement('div'));
  await act(async () =>
    root?.render(
      <QueryClientProvider client={client}>
        <Probe />
      </QueryClientProvider>,
    ),
  );
  await act(async () => write({ projectId: 'site-a', git: { connected: false, autoPublish: false } }));
  expect(client.getMutationCache().getAll()[0]?.state.status).toBe('pending');
  expectSafe();
  await act(async () => answerPatch(Response.json({ data: answer })));
  await act(async () => new Promise((done) => setTimeout(done, 0)));
  expect(mocks.patch).toHaveBeenCalledOnce();
  expect(client.getMutationCache().getAll()[0]?.state.status).toBe('success');
  expectSafe();
});

it('reconstructs non-enumerable error fields and permits an explicit query retry without retention', async () => {
  const raw = new ApiResponseError(SECRET, 403, 'http:forbidden', '9999999');
  Object.defineProperty(raw, 'cause', { value: { echoed: SECRET } });
  mocks.get.mockRejectedValueOnce(raw);
  await expect(client.fetchQuery(workspaceSettingsQueryOptions('site-a'))).rejects.toMatchObject({
    status: 403,
    code: 'http:forbidden',
    retryAfter: undefined,
  });
  expectSafe();
  await client.fetchQuery(workspaceSettingsQueryOptions('site-a'));
  expectSafe();
});

it('an offline settings GET resumes through the safe projection on reconnect; it never schedules a rotation', async () => {
  client.mount();
  onlineManager.setOnline(false);
  const pending = client.fetchQuery(workspaceSettingsQueryOptions('site-a'));
  expect(client.getQueryState(workspaceSettingsQueryOptions('site-a').queryKey)?.fetchStatus).toBe('paused');
  expect(mocks.get).not.toHaveBeenCalled();
  expectSafe();
  onlineManager.setOnline(true);
  await pending;
  client.unmount();
  expectSafe();
  expect(client.getMutationCache().getAll()).toEqual([]);
});

it.each(['get', 'patch'] as const)('reconstructs echoed %s errors before query/mutation retention', async (kind) => {
  mocks[kind].mockImplementation(async () =>
    Response.json(
      { error: { code: 'http:forbidden', message: SECRET, details: { reason: SECRET } } },
      { status: 403, headers: { 'retry-after': SECRET } },
    ),
  );
  if (kind === 'get')
    await expect(client.fetchQuery(workspaceSettingsQueryOptions('site-a'))).rejects.toMatchObject({ status: 403, code: 'http:forbidden' });
  else {
    let write: ReturnType<typeof useWriteGitSettings>['write'] = () => undefined;
    function Probe() {
      write = useWriteGitSettings('site-a').write;
      return null;
    }
    root = createRoot(document.createElement('div'));
    await act(async () =>
      root?.render(
        <QueryClientProvider client={client}>
          <Probe />
        </QueryClientProvider>,
      ),
    );
    await act(async () => write({ projectId: 'site-a', git: { connected: false } }));
    await act(async () => new Promise((done) => setTimeout(done, 0)));
    expect(client.getMutationCache().getAll()[0]?.state.status).toBe('error');
  }
  expectSafe();
});
