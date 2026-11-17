// @vitest-environment jsdom
// The Settings page's webhook rotation request (useGitSettingsWebhookRotate) on its own, with the app's QueryClient;
// only the HTTP calls are replaced. What the page cannot show: the sanitized error, the busy slot across sessions,
// and server rendering. Sites and secrets are fictional, low-entropy placeholders.
import { QueryClientProvider, useQuery } from '@tanstack/react-query';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { renderToString } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ settingsGet: vi.fn(), rotatePost: vi.fn() }));
vi.mock('@/services/api', () => {
  const answer = (path: string, request: { param?: { projectId?: string } } | undefined) => {
    if (path === 'settings.$get') return mocks.settingsGet(request?.param?.projectId);
    if (path === 'settings.git.webhook-secret.$post') return mocks.rotatePost(request);
    throw new Error(`unexpected API call ${path}`);
  };
  const node = (path: string[]): unknown =>
    new Proxy(() => undefined, {
      get: (_target, property) => (typeof property === 'string' && property !== 'then' ? node([...path, property]) : undefined),
      apply: (_target, _this, args: unknown[]) => answer(path.slice(3).join('.'), args[0] as { param?: { projectId?: string } } | undefined),
    });
  return { api: node([]) };
});

import { ApiResponseError } from '@/hooks/api/client-helpers';
import { workspaceSettingsQueryOptions } from '@/hooks/api/query-options';
import { createQueryClient } from '@/integrations/tanstack-query/query-client';
import { resetDashboardSession } from '@/integrations/tanstack-query/session-cache';
import { useGitSettingsWebhookRotate } from './git-settings-webhook-rotate';

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);

const SECRET = 'test-secret-0001';
const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });

let held: Array<(value: Response) => void>;
let client: ReturnType<typeof createQueryClient>;
const roots: Root[] = [];
type Rotation = ReturnType<typeof useGitSettingsWebhookRotate>;

/**
 * Mounts the hook for `projectId` beside the site's settings read, as the settings page has it (`key` stands in for
 * AppGuard's per-session remount), and returns its latest result.
 */
async function mount(projectId: string, key = 'first') {
  const latest: { current: Rotation | null } = { current: null };
  function Probe() {
    useQuery(workspaceSettingsQueryOptions(projectId));
    latest.current = useGitSettingsWebhookRotate(projectId);
    return null;
  }
  const root = createRoot(document.createElement('div'));
  roots.push(root);
  await act(async () =>
    root.render(
      <QueryClientProvider client={client}>
        <Probe key={key} />
      </QueryClientProvider>,
    ),
  );
  await act(async () => new Promise((done) => setTimeout(done, 0)));
  return () => latest.current as Rotation;
}
/** Starts a rotation and lets React render what it changed (the busy slot); `done` is the rotation itself. */
const start = async (hook: () => Rotation, site: string) => {
  let done: Promise<{ webhookSecret: string | null } | null> = Promise.resolve(null);
  await act(async () => {
    done = hook().rotate(site);
  });
  return { done };
};
const answer = async (index: number, response: Response) => {
  await act(async () => held[index]?.(response));
  await act(async () => new Promise((done) => setTimeout(done, 0)));
};

beforeEach(() => {
  held = [];
  client = createQueryClient();
  mocks.settingsGet.mockReset().mockImplementation(async () => json(200, { data: { git: {} } }));
  mocks.rotatePost.mockReset().mockImplementation(
    () =>
      new Promise<Response>((resolve) => {
        held.push(resolve);
      }),
  );
});
afterEach(async () => {
  for (const root of roots.splice(0)) await act(async () => root.unmount());
});

describe('a refusal comes back sanitized', () => {
  it('keeps the status, a code this route answers with and a numeric Retry-After; drops the message and details', async () => {
    const hook = await mount('site-a');
    const rotation = hook()
      .rotate('site-a')
      .catch((reason: unknown) => reason);
    await answer(
      0,
      json(429, { error: { code: 'http:rate_limited', message: `slow down ${SECRET}`, details: { reason: SECRET } } }, { 'retry-after': '30' }),
    );
    const error = await rotation;
    expect(error).toBeInstanceOf(ApiResponseError);
    expect(error).toMatchObject({ status: 429, code: 'http:rate_limited', retryAfter: '30', message: 'Could not rotate the webhook secret.' });
    expect((error as ApiResponseError).details).toBeUndefined();
    expect(JSON.stringify(Object.getOwnPropertyNames(error).map((name) => (error as Record<string, unknown>)[name]))).not.toContain(SECRET);
  });

  it('drops an unknown code and a non-numeric Retry-After; a dropped request is a plain network error', async () => {
    const hook = await mount('site-a');
    const refused = hook()
      .rotate('site-a')
      .catch((reason: unknown) => reason);
    await answer(0, json(403, { error: { code: `echo ${SECRET}` } }, { 'retry-after': `echo ${SECRET}` }));
    const error = (await refused) as ApiResponseError;
    expect(error).toMatchObject({ status: 403, code: undefined, retryAfter: undefined });

    mocks.rotatePost.mockImplementationOnce(() => Promise.reject(new TypeError(`Failed to fetch ${SECRET}`)));
    const dropped = await hook()
      .rotate('site-a')
      .catch((reason: unknown) => reason);
    expect(dropped).toBeInstanceOf(TypeError);
    expect((dropped as TypeError).message).toBe('Could not rotate the webhook secret.');
  });
});

describe('the busy slot belongs to the session and site that started it', () => {
  it('a late answer after a session change resolves false, re-reads nothing, and frees only its own slot', async () => {
    const first = await mount('site-a');
    const { done: old } = await start(first, 'site-a');
    expect(first().pending).toBe(true);
    await act(async () => resetDashboardSession(client));
    const next = await mount('site-a', 'next-session');
    expect(next().pending).toBe(false);
    const { done: current } = await start(next, 'site-a');
    expect(mocks.rotatePost).toHaveBeenCalledTimes(2);
    expect(next().pending).toBe(true);

    const readsBefore = mocks.settingsGet.mock.calls.length;
    await answer(0, json(200, { data: { webhookSecret: SECRET } }));
    await expect(old).resolves.toBeNull();
    expect(mocks.settingsGet.mock.calls.length).toBe(readsBefore);
    // The old session's answer did not free the new session's rotation.
    expect(next().pending).toBe(true);
    await answer(1, json(200, { data: { webhookSecret: SECRET } }));
    await expect(current).resolves.toEqual({ webhookSecret: SECRET });
    expect(next().pending).toBe(false);
  });

  it('resolves true only after the site’s settings read, and a press meanwhile sends nothing', async () => {
    const hook = await mount('site-a');
    let finishRead: (value: Response) => void = () => undefined;
    mocks.settingsGet.mockImplementationOnce(
      () =>
        new Promise<Response>((resolve) => {
          finishRead = resolve;
        }),
    );
    const { done: rotation } = await start(hook, 'site-a');
    await answer(0, json(200, { data: { webhookSecret: SECRET } }));
    expect(hook().pending).toBe(true);
    await expect(hook().rotate('site-a')).resolves.toBeNull();
    expect(mocks.rotatePost).toHaveBeenCalledTimes(1);
    await act(async () => finishRead(json(200, { data: { git: {} } })));
    await expect(rotation).resolves.toEqual({ webhookSecret: SECRET });
    await act(async () => new Promise((done) => setTimeout(done, 0)));
    expect(hook().pending).toBe(false);
  });
});

describe('server rendering', () => {
  it('renders idle on the server, even while this client has a rotation in flight', async () => {
    const hook = await mount('site-a');
    await start(hook, 'site-a');
    expect(hook().pending).toBe(true);
    function Probe() {
      return <span>{String(useGitSettingsWebhookRotate('site-a').pending)}</span>;
    }
    const html = renderToString(
      <QueryClientProvider client={client}>
        <Probe />
      </QueryClientProvider>,
    );
    expect(html).toBe('<span>false</span>');
  });
});
