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
// All settings reads and both dehydration modes must be free of secrets. Only the live request
// and its owning panel may hold a one-time answer. Tests intercept HTTP, not the settings query.
import { writeFileSync } from 'node:fs';
import { ConfirmProvider } from '@nibleaf/design-system/components/ui/confirm';
import { translateFn } from '@nibleaf/i18n';
import { dehydrate, onlineManager, type QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ settingsGet: vi.fn(), rotatePost: vi.fn(), copy: vi.fn(), error: vi.fn(), success: vi.fn() }));
vi.mock('@/lib/invitations', () => ({ copyToClipboard: mocks.copy }));
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

/** Fictional private storage: settings exposes only whether a secret exists. */
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
      webhookConfigured: Boolean(stored[projectId]),
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
    actionName: () => rotateButton()?.textContent?.trim(),
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
/** Every cache entry, options/state and non-enumerable error field, session record and dehydration. */
const expectNothingKept = (queryClient: QueryClient = client) => {
  expect(queryClient.getMutationCache().getAll()).toEqual([]);
  const text = [
    reachable(queryClient.getQueryCache().getAll()),
    reachable(queryClient.getMutationCache().getAll()),
    reachable(sessionOf(queryClient)),
    reachable(dehydrate(queryClient, { shouldDehydrateMutation: () => true, shouldDehydrateQuery: () => true })),
    reachable(dehydrate(queryClient)),
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
  mocks.copy.mockReset().mockResolvedValue(true);
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
    expect(tab.field()).toBeNull();
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
    expect(tab.field()).toBeNull();
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
    expect(tab.field()).toBeNull();
    await rotated(1, SECRET_A);
    expect(tab.field()).toBeNull();
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
    expect(tab.field()).toBeNull();
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
    expect(tab.field()).toBeNull();
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

// Failing-first ordinary main: the real settings query retained the legacy HTTP value and the tab
// revealed that query value after rotation. This is an older-server compatibility answer after #855.
it('ordinary main repro / legacy-server compatibility: stored query secret cannot be revealed', async () => {
  mocks.settingsGet.mockImplementation(async (projectId: string) => {
    const result = settings(projectId);
    return json(200, { data: { ...result.data, git: { ...result.data.git, webhookSecret: stored[projectId] } } });
  });
  const tab = dashboard();
  await tab.open('site-a');
  if (process.env.NIBLEAF_855_BASELINE === '1') {
    const report = {
      baseline: 'c3285e6c2de544aa251b627924f513758be0815d',
      case: 'ordinary main HTTP settings response; real QueryClient, settings query, GitTab and rotation command; held HTTP only',
      storedCredential: '<credential#2>',
      responseCredential: '<credential#1>',
      queryRetainsStored: reachable(client.getQueryCache().getAll()).includes(SECRET_B),
      defaultDehydrateRetainsStored: reachable(dehydrate(client)).includes(SECRET_B),
      initialFieldHoldsStored: tab.field()?.value === SECRET_B,
    };
    await tab.press();
    await rotated(0, SECRET_A);
    const rotatedField = tab.field();
    const ordinary = {
      ...report,
      rotatesViaMutation: client.getMutationCache().getAll().length > 0,
      rotatedQueryRetainsAnswer: reachable(client.getQueryCache().getAll()).includes(SECRET_A),
      revealsAfterQueryReadback: rotatedField?.value === SECRET_A && rotatedField.revealed,
    };
    // Deliberate divergence is a synthetic sensitivity probe, separate from ordinary route-shaped persistence.
    mocks.settingsGet.mockImplementation(async (projectId: string) => {
      const result = settings(projectId);
      return json(200, { data: { ...result.data, git: { ...result.data.git, webhookSecret: SECRET_B } } });
    });
    await tab.press();
    await rotated(1, SECRET_A);
    const result = {
      ordinary,
      syntheticStaleReadback: {
        label: 'synthetic HTTP readback deliberately differs from the explicit rotation response',
        revealsQueryInsteadOfResponse: tab.field()?.value === SECRET_B && tab.field()?.revealed,
      },
    };
    if (process.env.NIBLEAF_855_REPORT) writeFileSync(process.env.NIBLEAF_855_REPORT, JSON.stringify(result, null, 2));
    expect(result).toMatchObject({
      ordinary: {
        queryRetainsStored: true,
        defaultDehydrateRetainsStored: true,
        initialFieldHoldsStored: true,
        rotatesViaMutation: false,
        rotatedQueryRetainsAnswer: true,
        revealsAfterQueryReadback: true,
      },
      syntheticStaleReadback: { revealsQueryInsteadOfResponse: true },
    });
    return;
  }
  expectNothingKept();
  expect(tab.field()).toBeNull();
});

it('remount and reload expose configured status and Rotate, never the previous one-time answer', async () => {
  const tab = dashboard();
  await tab.open('site-a');
  expect(tab.field()).toBeNull();
  expect(tab.hasRotateButton()).toBe(true);
  await tab.press();
  await rotated(0, SECRET_A);
  expect(tab.field()).toEqual({ value: SECRET_A, revealed: true });
  await tab.leave();
  await tab.open('site-a');
  expect(tab.field()).toBeNull();
  client = createQueryClient();
  await tab.open('site-a', 'reload');
  expect(tab.field()).toBeNull();
  expect(tab.hasRotateButton()).toBe(true);
  expectNothingKept();
});

it('the one-time answer is copyable in its current panel and survives a failed post-success settings refetch', async () => {
  client.setDefaultOptions({ ...client.getDefaultOptions(), queries: { ...client.getDefaultOptions().queries, retry: false } });
  const tab = dashboard();
  await tab.open('site-a');
  await tab.press();
  mocks.settingsGet.mockImplementationOnce(async () => json(500, { error: { message: SECRET_A } }));
  await rotated(0, SECRET_A);
  expect(tab.field()).toEqual({ value: SECRET_A, revealed: true });
  const buttons = [...tab.host.querySelectorAll<HTMLButtonElement>('button')].filter(
    (button) => button.getAttribute('aria-label') === t('settings.git.webhook.copy'),
  );
  await act(async () => buttons.at(-1)?.click());
  await settle();
  expect(mocks.copy).toHaveBeenLastCalledWith(SECRET_A);
  expectNothingKept();
  expect(tab.actionName()).toBe(t('settings.git.webhook.rotate'));
});

it.each(['site', 'leave', 'session', 'client'] as const)('retires the answer while response-body parsing is held: %s', async (retirement) => {
  let activeClient = client;
  const tab = dashboard(() => activeClient);
  await tab.open('site-a', 'unkeyed');
  await tab.press();
  let finish: (answer: unknown) => void = () => undefined;
  const response = json(200, {});
  vi.spyOn(response, 'json').mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  await refused(0, response);
  expect(tab.busy()).toBe(true);
  if (retirement === 'site') {
    await tab.open('site-b', 'unkeyed');
    await tab.open('site-a', 'unkeyed');
  }
  if (retirement === 'leave') {
    await tab.leave();
    await tab.open('site-a');
  }
  if (retirement === 'session') {
    await act(async () => resetDashboardSession(client));
    await tab.open('site-a', 'session-next');
  }
  if (retirement === 'client') {
    activeClient = createQueryClient();
    await tab.open('site-a', 'unkeyed');
  }
  await act(async () => finish({ data: { webhookSecret: SECRET_A } }));
  await settle();
  expect(tab.field()).toBeNull();
  expect(toasts()).toEqual({ success: [], error: [] });
  expectNothingKept();
  expectNothingKept(activeClient);
});

it.each(['site', 'session', 'client'] as const)(
  'clears an already displayed answer on %s replacement without relying on a keyed remount',
  async (replacement) => {
    let activeClient = client;
    const tab = dashboard(() => activeClient);
    await tab.open('site-a', 'unkeyed');
    await tab.press();
    await rotated(0, SECRET_A);
    expect(tab.field()?.value).toBe(SECRET_A);
    if (replacement === 'site') await tab.open('site-b', 'unkeyed');
    if (replacement === 'session') await act(async () => resetDashboardSession(client));
    if (replacement === 'client') {
      activeClient = createQueryClient();
      await tab.open('site-a', 'unkeyed');
    }
    await settle();
    expect(tab.field()).toBeNull();
    expectNothingKept(activeClient);
  },
);

it('suppresses a pending clipboard completion after leaving and returning', async () => {
  const tab = dashboard();
  await tab.open('site-a');
  await tab.press();
  await rotated(0, SECRET_A);
  let finish: (ok: boolean) => void = () => undefined;
  mocks.copy.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const buttons = [...tab.host.querySelectorAll<HTMLButtonElement>('button')].filter(
    (button) => button.getAttribute('aria-label') === t('settings.git.webhook.copy'),
  );
  await act(async () => buttons.at(-1)?.click());
  mocks.success.mockClear();
  await tab.leave();
  await tab.open('site-a');
  await act(async () => finish(true));
  await settle();
  expect(toasts()).toEqual({ success: [], error: [] });
  expect(tab.field()).toBeNull();
  expectNothingKept();
});

it('holds busy through readback and suppresses a late reveal when the panel leaves during that read', async () => {
  const tab = dashboard();
  await tab.open('site-a');
  await tab.press();
  const readback = holdNextRead('site-a');
  await rotated(0, SECRET_A);
  expect(tab.busy()).toBe(true);
  await tab.leave();
  await tab.open('site-a');
  expect(tab.busy()).toBe(true);
  await tab.press();
  expect(posts()).toHaveLength(1);
  await readback.answer();
  expect(tab.field()).toBeNull();
  expect(toasts()).toEqual({ success: [], error: [] });
  expectNothingKept();
});

it('synthetic stale readback differs from the explicit answer: only the request answer is displayed', async () => {
  const tab = dashboard();
  await tab.open('site-a');
  mocks.settingsGet.mockImplementation(async (projectId: string) => {
    const result = settings(projectId);
    return json(200, { data: { ...result.data, git: { ...result.data.git, webhookSecret: SECRET_B } } });
  });
  await tab.press();
  await rotated(0, SECRET_A);
  expect(tab.field()).toEqual({ value: SECRET_A, revealed: true });
  expectNothingKept();
});

it('creation is known to be configured even if readback fails; a later refused rotation drops its old value', async () => {
  stored = {};
  client.setDefaultOptions({ ...client.getDefaultOptions(), queries: { ...client.getDefaultOptions().queries, retry: false } });
  const tab = dashboard();
  await tab.open('site-a');
  expect(tab.actionName()).toBe(t('settings.git.webhook.generate'));
  await tab.press();
  mocks.settingsGet.mockImplementationOnce(async () => json(500, { error: { message: SECRET_A } }));
  await rotated(0, SECRET_A);
  expect(tab.field()?.value).toBe(SECRET_A);
  expect(tab.actionName()).toBe(t('settings.git.webhook.rotate'));
  await tab.press();
  await refused(1, json(403, { error: { code: 'http:forbidden' } }));
  expect(tab.field()).toBeNull();
  expect(tab.actionName()).toBe(t('settings.git.webhook.rotate'));
  expectNothingKept();
});
