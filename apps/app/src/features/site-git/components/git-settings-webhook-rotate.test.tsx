// @vitest-environment jsdom
// Settings → Git → (legacy import) Deploy on push → Generate / Rotate webhook secret. The real GitTab, its settings
// query, Pipeline card, repository form and rotation with the app's own QueryClient; only the HTTP calls are replaced
// (every API call is answered here) and a rotation POST, or a settings read, can be held until the test answers it.
// The per-site GitWorkflow above it renders as nothing: it has its own rotation and tests. Sites and secrets are
// fictional, low-entropy placeholders; nothing reaches a server or a provider.
//
// Which cases ordinary use reaches: a press, leaving for another site and coming back (the settings page keys the Git
// tab by site: an unmount and a new instance) while the rotation runs, leaving the page, a refusal, a dropped request,
// offline, and a session change (AppGuard remounts the dashboard). Two presses in the same tick are not reachable by a
// person (the button shows busy after the first render); that test says "programmatic".
//
// The settings read itself answers an admin with the site's webhook secret, and the settings page shows it from that
// read (main's contract, unchanged here). So the checks below leave that one query's data out and look everywhere
// else: the secret must never be held by a mutation, its options or error, another query, or a dehydration.
import { ConfirmProvider } from '@nibleaf/design-system/components/ui/confirm';
import { translateFn } from '@nibleaf/i18n';
import { defaultShouldDehydrateQuery, dehydrate, onlineManager, type Query, type QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ settingsGet: vi.fn(), rotatePost: vi.fn(), error: vi.fn(), success: vi.fn() }));
vi.mock('sonner', () => ({ toast: { error: mocks.error, success: mocks.success } }));
vi.mock('@nibleaf/i18n/react', async () => {
  const { translateFn: translate } = await vi.importActual<typeof import('@nibleaf/i18n')>('@nibleaf/i18n');
  const t = (key: Parameters<typeof translate>[0], variables?: Parameters<typeof translate>[1]) => translate(key, variables, 'en');
  return { useT: () => t, useLocale: () => ({ locale: 'en', t }) };
});
vi.mock('@/env', () => ({ env: { VITE_APP_URL: 'https://app.fixture.test' } }));
vi.mock('@/components/settings/git-workflow', () => ({ GitWorkflow: () => null }));
// Every API call: a settings read, a rotation, or another read the tab makes (answered empty); anything else fails.
vi.mock('@/services/api', () => {
  const answer = (path: string, request: { param?: { projectId?: string } } | undefined) => {
    if (path === 'settings.$get') return mocks.settingsGet(request?.param?.projectId);
    if (path === 'settings.git.webhook-secret.$post') return mocks.rotatePost(request);
    if (path === 'git.$get') return Promise.resolve(Response.json({ data: null }));
    if (path.endsWith('$get')) return Promise.resolve(Response.json({ data: [] }));
    throw new Error(`unexpected API call ${path}`);
  };
  const node = (path: string[]): unknown =>
    new Proxy(() => undefined, {
      get: (_target, property) => (typeof property === 'string' && property !== 'then' ? node([...path, property]) : undefined),
      apply: (_target, _this, args: unknown[]) => answer(path.slice(3).join('.'), args[0] as { param?: { projectId?: string } } | undefined),
    });
  return { api: node([]) };
});

import { GitTab } from '@/components/settings/git-tab';
import { createQueryClient } from '@/integrations/tanstack-query/query-client';
import { resetDashboardSession } from '@/integrations/tanstack-query/session-cache';
import { sessionOf } from '@/integrations/tanstack-query/session-generation';

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);

const t = (key: Parameters<typeof translateFn>[0]) => translateFn(key, undefined, 'en');
const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });
const SECRET_A = 'test-secret-0001';
const SECRET_B = 'test-secret-0002';

/** The secret each fictional site has stored, as the settings read answers an admin with it. */
let stored: Record<string, string | undefined>;
const settings = (projectId: string) => ({
  data: {
    plan: 'free',
    notifications: {},
    integrations: {},
    git: {
      connected: true,
      provider: 'gitlab',
      repo: `acme-fixture/${projectId}`,
      branch: 'main',
      path: 'docs',
      ...(stored[projectId] ? { webhookSecret: stored[projectId] } : {}),
    },
    name: 'Acme Fixture',
    slug: 'acme-fixture',
    projectCount: 2,
    memberCount: 1,
  },
});

/** Lets requests settle: TanStack tells React on a timer, so each tick gets its own act. */
const settle = async () => {
  for (let tick = 0; tick < 4; tick += 1) await act(async () => new Promise((done) => setTimeout(done, 0)));
};
type RotateRequest = { param: { projectId: string } };
/** Rotation POSTs held until the test answers them, in the order they were sent. */
let held: Array<{ request: RotateRequest; resolve: (value: Response) => void; reject: (error: unknown) => void }>;
/** As the route answers a rotation: it stores the new secret and answers with it once. */
const rotated = async (index: number, secret = SECRET_A) => {
  const entry = held[index];
  if (!entry) throw new Error(`no held rotation #${index}`);
  stored[entry.request.param.projectId] = secret;
  await act(async () => entry.resolve(json(200, { data: { webhookSecret: secret } })));
  await settle();
};
const refused = async (index: number, response: Response) => {
  await act(async () => held[index]?.resolve(response));
  await settle();
};
const drop = async (index: number) => {
  await act(async () => held[index]?.reject(new TypeError('Failed to fetch')));
  await settle();
};
/** The next settings read of `projectId`, held until the test answers it. */
const holdNextRead = (projectId: string) => {
  let resolve: (value: Response) => void = () => undefined;
  const reading = new Promise<Response>((done) => {
    resolve = done;
  });
  const original = mocks.settingsGet.getMockImplementation();
  mocks.settingsGet.mockImplementation((site: string) => {
    if (site !== projectId) return original?.(site);
    mocks.settingsGet.mockImplementation(original as never);
    return reading;
  });
  return {
    answer: async () => {
      await act(async () => resolve(json(200, settings(projectId))));
      await settle();
    },
  };
};

let client: QueryClient;
const hosts: Array<{ host: HTMLDivElement; root: Root }> = [];
/**
 * A dashboard: one QueryClientProvider that stays mounted (as the app's does), showing a site's Git tab keyed by site
 * as the settings page keys it, or another page.
 */
function dashboard(queryClient: () => QueryClient = () => client) {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  hosts.push({ host, root });
  const show = (content: React.ReactNode) =>
    act(async () =>
      root.render(
        <QueryClientProvider client={queryClient()}>
          <ConfirmProvider>{content}</ConfirmProvider>
        </QueryClientProvider>,
      ),
    );
  const rotateButton = () =>
    [...host.querySelectorAll<HTMLButtonElement>('button')].find((item) =>
      [t('settings.git.webhook.rotate'), t('settings.git.webhook.generate')].includes(item.textContent?.trim() ?? ''),
    );
  return {
    host,
    /** The site's Git tab, keyed by site (`key` stands in for AppGuard's per-session remount). */
    open: async (projectId: string, key = `git-${projectId}`) => {
      await show(<GitTab key={key} projectId={projectId} />);
      await settle();
    },
    /** Another dashboard page: the Git tab unmounts, the QueryClient and its provider stay. */
    leave: async () => {
      await show(<div />);
      await settle();
    },
    press: async () => {
      await act(async () => rotateButton()?.click());
      await settle();
    },
    /** Two presses in one tick, before React renders the first one's busy state. */
    pressTwiceInOneTick: async () => {
      await act(async () => {
        const button = rotateButton();
        button?.click();
        button?.click();
      });
      await settle();
    },
    hasRotateButton: () => rotateButton() !== undefined,
    busy: () => rotateButton()?.getAttribute('aria-busy') === 'true',
    /** The secret field: its value and whether it is revealed. */
    field: () => {
      const input = host.querySelector<HTMLInputElement>('#git-webhook-secret');
      return input ? { value: input.value, revealed: !input.hasAttribute('data-masked') } : null;
    },
  };
}
const posts = () => mocks.rotatePost.mock.calls.map(([request]) => request as RotateRequest);
const reads = (projectId: string) => mocks.settingsGet.mock.calls.filter(([site]) => site === projectId).length;
const toasts = () => ({ success: mocks.success.mock.calls.map(([message]) => message), error: mocks.error.mock.calls.map(([message]) => message) });

/**
 * Every string reachable from `root`: own properties, enumerable or not (an Error's message, stack and cause), Map and
 * Set entries, and each function's source; cycles walked once, and `skip` never entered.
 */
const reachable = (root: unknown, skip: object[] = []) => {
  const seen = new WeakSet<object>(skip);
  const found: string[] = [];
  const walk = (value: unknown) => {
    if (typeof value === 'string') return void found.push(value);
    if (!value || (typeof value !== 'object' && typeof value !== 'function')) return;
    if (seen.has(value)) return;
    seen.add(value);
    if (typeof value === 'function') found.push(Function.prototype.toString.call(value));
    if (value instanceof Map) for (const [key, item] of value) [key, item].forEach(walk);
    if (value instanceof Set) for (const item of value) walk(item);
    for (const key of Reflect.ownKeys(value)) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (descriptor && 'value' in descriptor) walk(descriptor.value);
    }
  };
  walk(root);
  return found.join('\n');
};
/** The settings read, which answers an admin with the stored secret (main's contract; see the header). */
const isSettingsRead = (query: Query) => query.queryKey[0] === 'workspace' && query.queryKey[1] === 'settings';
/**
 * Nothing the QueryClient keeps or hands on holds a placeholder secret, outside the settings read's own data: no
 * mutation at all (the rotation is a direct request); no other query; the session's cache record; an all-mutation
 * and all-query dehydration and the default one (what an offline persister would keep); no console line; no toast.
 */
const expectNothingKept = (queryClient: QueryClient = client) => {
  expect(queryClient.getMutationCache().getAll()).toEqual([]);
  const settingsReads = queryClient.getQueryCache().findAll({ predicate: isSettingsRead });
  const text = [
    reachable(queryClient.getQueryCache().getAll(), settingsReads),
    reachable(queryClient.getMutationCache().getAll(), settingsReads),
    reachable(sessionOf(queryClient), settingsReads),
    JSON.stringify(dehydrate(queryClient, { shouldDehydrateMutation: () => true, shouldDehydrateQuery: (query) => !isSettingsRead(query) })),
    JSON.stringify(dehydrate(queryClient, { shouldDehydrateQuery: (query) => defaultShouldDehydrateQuery(query) && !isSettingsRead(query) })),
    reachable(vi.mocked(console.error).mock.calls),
    reachable(vi.mocked(console.warn).mock.calls),
    reachable(vi.mocked(console.log).mock.calls),
    JSON.stringify(toasts()),
  ].join('\n');
  for (const value of [SECRET_A, SECRET_B, 'test-secret']) expect(text).not.toContain(value);
};

beforeEach(() => {
  held = [];
  stored = { 'site-a': SECRET_B };
  onlineManager.setOnline(true);
  client = createQueryClient();
  mocks.settingsGet.mockReset().mockImplementation(async (projectId: string) => json(200, settings(projectId)));
  mocks.rotatePost.mockReset().mockImplementation(
    (request: RotateRequest) =>
      new Promise<Response>((resolve, reject) => {
        held.push({ request, resolve, reject });
      }),
  );
  mocks.error.mockReset();
  mocks.success.mockReset();
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
});
afterEach(async () => {
  for (const { host, root } of hosts.splice(0)) {
    await act(async () => root.unmount());
    host.remove();
  }
  onlineManager.setOnline(true);
  vi.restoreAllMocks();
});

describe('a press sends the route’s exact request once, re-reads the site, then reveals the new secret', () => {
  it('sends one empty POST for the site, stays busy until the settings read is back, then reveals with one toast', async () => {
    const tab = dashboard();
    await tab.open('site-a');
    expect(tab.field()).toEqual({ value: SECRET_B, revealed: false });
    await tab.press();
    // The route as main calls it: POST /settings/git/webhook-secret for this site, no body or query; the api client
    // adds the session cookie as for every dashboard call.
    expect(posts()).toEqual([{ param: { projectId: 'site-a' } }]);
    expect(Object.keys(posts()[0] ?? {})).toEqual(['param']);
    expect(tab.busy()).toBe(true);
    expectNothingKept();

    const before = reads('site-a');
    const readback = holdNextRead('site-a');
    await rotated(0, SECRET_A);
    // The answer is in, the settings read is not: still busy, nothing revealed or toasted yet.
    expect(reads('site-a')).toBe(before + 1);
    expect(tab.busy()).toBe(true);
    expect(tab.field()?.revealed).toBe(false);
    expect(toasts()).toEqual({ success: [], error: [] });
    await readback.answer();
    expect(tab.busy()).toBe(false);
    expect(tab.field()).toEqual({ value: SECRET_A, revealed: true });
    expect(toasts()).toEqual({ success: [t('settings.git.webhook.rotated')], error: [] });
    expect(posts()).toHaveLength(1);
    expectNothingKept();

    await tab.leave();
    expectNothingKept();
  });

  it('a site with no secret yet: Generate sends the same request and reveals the first secret', async () => {
    stored = {};
    const tab = dashboard();
    await tab.open('site-a');
    expect(tab.field()).toBeNull();
    await tab.press();
    expect(posts()).toEqual([{ param: { projectId: 'site-a' } }]);
    await rotated(0, SECRET_A);
    expect(tab.field()).toEqual({ value: SECRET_A, revealed: true });
    expectNothingKept();
  });

  it('programmatic: two presses in the same tick send once', async () => {
    const tab = dashboard();
    await tab.open('site-a');
    await tab.pressTwiceInOneTick();
    expect(posts()).toHaveLength(1);
    expect(tab.busy()).toBe(true);
    await rotated(0);
    expect(toasts().success).toEqual([t('settings.git.webhook.rotated')]);
  });
});

describe('a press belongs to the tab, site and session that made it', () => {
  it('keyed A → B → A while A rotates: B is idle and rotates on its own; A comes back busy; A’s answer re-reads A and shows nowhere', async () => {
    stored = { 'site-a': SECRET_B, 'site-b': SECRET_B };
    const tab = dashboard();
    await tab.open('site-a');
    await tab.press();
    await tab.open('site-b');
    expect(tab.busy()).toBe(false);
    await tab.press();
    expect(posts().map((request) => request.param.projectId)).toEqual(['site-a', 'site-b']);
    await tab.open('site-a');
    expect(tab.busy()).toBe(true);
    // The same-site remount gets no second rotation while the first is in flight.
    await tab.press();
    expect(posts()).toHaveLength(2);
    const before = reads('site-a');
    await rotated(0, SECRET_A);
    expect(reads('site-a')).toBeGreaterThan(before);
    expect(tab.busy()).toBe(false);
    expect(tab.field()).toEqual({ value: SECRET_A, revealed: false });
    await rotated(1, SECRET_A);
    expect(tab.field()?.revealed).toBe(false);
    expect(toasts()).toEqual({ success: [], error: [] });
    expectNothingKept();
  });

  it('a session reset while the rotation runs: the next session’s tab is idle, and the late answer reveals or toasts nothing', async () => {
    const tab = dashboard();
    await tab.open('site-a');
    await tab.press();
    await act(async () => resetDashboardSession(client));
    // AppGuard remounts the dashboard for the next session.
    await tab.open('site-a', 'git-site-a-next-session');
    expect(tab.busy()).toBe(false);
    await rotated(0, SECRET_A);
    expect(tab.field()?.revealed).toBe(false);
    expect(toasts()).toEqual({ success: [], error: [] });
    expectNothingKept();
  });

  it('a session reset while the rotation runs: a late refusal toasts nothing', async () => {
    const tab = dashboard();
    await tab.open('site-a');
    await tab.press();
    await act(async () => resetDashboardSession(client));
    await tab.open('site-a', 'git-site-a-next-session');
    await refused(0, json(500, { error: { code: 'http:internal', message: 'Internal error' } }));
    expect(toasts()).toEqual({ success: [], error: [] });
    expectNothingKept();
  });
});

describe('failures are reported once, with nothing the server sent, and never repeated automatically', () => {
  it('a refusal toasts once and keeps nothing it carried, even in non-enumerable fields; a new press then succeeds', async () => {
    const tab = dashboard();
    await tab.open('site-a');
    await tab.press();
    const echo = `echo ${SECRET_A}`;
    await refused(
      0,
      json(403, { error: { code: echo, message: echo, details: { reason: echo, path: echo, sourceFile: echo } } }, { 'retry-after': echo }),
    );
    expect(toasts()).toEqual({ success: [], error: [t('settings.git.webhook.rotateError')] });
    expect(tab.busy()).toBe(false);
    expect(tab.field()?.revealed).toBe(false);
    expectNothingKept();

    await tab.press();
    expect(posts()).toHaveLength(2);
    await rotated(1, SECRET_A);
    expect(tab.field()).toEqual({ value: SECRET_A, revealed: true });
    expect(toasts().success).toEqual([t('settings.git.webhook.rotated')]);
    expectNothingKept();
  });

  it('a dropped request (its outcome unknown) reports once and is never sent again until pressed again', async () => {
    const tab = dashboard();
    await tab.open('site-a');
    await tab.press();
    await drop(0);
    expect(toasts().error).toEqual([t('settings.git.webhook.rotateError')]);
    await act(async () => new Promise((done) => setTimeout(done, 50)));
    expect(posts()).toHaveLength(1);
    await tab.press();
    expect(posts()).toHaveLength(2);
  });

  it('offline: the press is sent now or not at all; nothing is paused, and reconnecting after leaving sends nothing', async () => {
    const tab = dashboard();
    await tab.open('site-a');
    await act(async () => onlineManager.setOnline(false));
    await tab.press();
    expect(posts()).toHaveLength(1);
    expect(dehydrate(client).mutations).toEqual([]);
    expectNothingKept();
    await drop(0);
    await tab.leave();
    await act(async () => onlineManager.setOnline(true));
    await settle();
    expect(posts()).toHaveLength(1);
    expectNothingKept();
  });
});
