// @vitest-environment jsdom
// Settings → Git → Connection → Webhook → Rotate webhook secret. The real GitWorkflow, status query, confirmation
// dialog and rotation with the app's own QueryClient; only the HTTP calls are replaced (every API call is answered
// here) and a rotation POST, or a status read, can be held until the test answers it. Sites and secrets are
// fictional, low-entropy placeholders; nothing reaches a server or a provider.
//
// Which cases ordinary use reaches: a press and its confirmation, a cancel, leaving for another site and coming back
// (the settings page keys the Git tab by site: an unmount and a new instance) while the dialog is open or the rotation
// runs, two dashboards (two QueryClients) on one site, a refusal, a dropped request, offline, and a session change
// (AppGuard remounts the dashboard). Two panels of one site in one QueryClient confirmed in the same tick are not
// reachable through the settings page; that test says "programmatic".
import { ConfirmProvider } from '@nibleaf/design-system/components/ui/confirm';
import { translateFn } from '@nibleaf/i18n';
import { dehydrate, onlineManager, type QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ statusGet: vi.fn(), rotatePost: vi.fn(), error: vi.fn(), success: vi.fn() }));
vi.mock('sonner', () => ({ toast: { error: mocks.error, success: mocks.success } }));
vi.mock('@nibleaf/i18n/react', async () => {
  const { translateFn: translate } = await vi.importActual<typeof import('@nibleaf/i18n')>('@nibleaf/i18n');
  return {
    useLocale: () => ({
      locale: 'en',
      t: (key: Parameters<typeof translate>[0], variables?: Parameters<typeof translate>[1]) => translate(key, variables, 'en'),
    }),
  };
});
vi.mock('@/env', () => ({ env: { VITE_APP_URL: 'https://app.fixture.test' } }));
// Every API call: a status read or a rotation; anything else fails the test.
vi.mock('@/services/api', () => {
  const answer = (path: string, request: { param?: { projectId?: string } } | undefined) => {
    if (path === 'git.$get') return mocks.statusGet(request?.param?.projectId);
    if (path === 'git.webhook-secret.$post') return mocks.rotatePost(request);
    throw new Error(`unexpected API call ${path}`);
  };
  const node = (path: string[]): unknown =>
    new Proxy(() => undefined, {
      get: (_target, property) => (typeof property === 'string' && property !== 'then' ? node([...path, property]) : undefined),
      apply: (_target, _this, args: unknown[]) => answer(path.slice(3).join('.'), args[0] as { param?: { projectId?: string } } | undefined),
    });
  return { api: node([]) };
});

import { GitWorkflow } from '@/components/settings/git-workflow';
import { createQueryClient } from '@/integrations/tanstack-query/query-client';
import { resetDashboardSession } from '@/integrations/tanstack-query/session-cache';
import { sessionOf } from '@/integrations/tanstack-query/session-generation';

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);

const t = (key: Parameters<typeof translateFn>[0]) => translateFn(key, undefined, 'en');
const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });
const SECRET_A = 'test-secret-0001';
const SECRET_B = 'test-secret-0002';
const status = (projectId: string) => ({
  id: `connection-${projectId}`,
  repository: `acme-fixture/${projectId}`,
  baseBranch: 'main',
  headBranch: 'nibleaf/docs',
  contentPath: 'docs',
  importBranchId: null,
  importLanguageId: null,
  credentialConfigured: true,
  webhookConfigured: true,
  lastSyncStatus: 'READY',
  lastSyncError: null,
  lastSyncedAt: null,
  operations: [],
  pullRequests: [],
  files: [],
});

/** Lets requests settle: TanStack tells React on a timer, so each tick gets its own act. */
const settle = async () => {
  for (let tick = 0; tick < 4; tick += 1) await act(async () => new Promise((done) => setTimeout(done, 0)));
};
type RotateRequest = { param: { projectId: string } };
/** Rotation POSTs held until the test answers them, in the order they were sent. */
let held: Array<{ request: RotateRequest; resolve: (value: Response) => void; reject: (error: unknown) => void }>;
const answer = async (index: number, response: Response) => {
  const entry = held[index];
  if (!entry) throw new Error(`no held rotation #${index}`);
  await act(async () => entry.resolve(response));
  await settle();
};
const drop = async (index: number) => {
  await act(async () => held[index]?.reject(new TypeError('Failed to fetch')));
  await settle();
};
/** As the route answers a rotation: the new secret, once. */
const rotated = (secret = SECRET_A) => json(200, { data: { webhookSecret: secret } });
/** A status read held until the test answers it (the next read of `projectId`). */
const holdNextRead = (projectId: string) => {
  let resolve: (value: Response) => void = () => undefined;
  const reading = new Promise<Response>((done) => {
    resolve = done;
  });
  const original = mocks.statusGet.getMockImplementation();
  mocks.statusGet.mockImplementation((site: string) => {
    if (site !== projectId) return original?.(site);
    mocks.statusGet.mockImplementation(original as never);
    return reading;
  });
  return {
    answer: async () => {
      await act(async () => resolve(json(200, { data: status(projectId) })));
      await settle();
    },
  };
};

let client: QueryClient;
const hosts: Array<{ host: HTMLDivElement; root: Root }> = [];
/** The confirmation dialog's buttons (rendered in a portal), by label. */
const dialogButton = (label: Parameters<typeof translateFn>[0] | 'Cancel') =>
  [...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button, [role="alertdialog"] button')].find(
    (item) => item.textContent?.trim() === (label === 'Cancel' ? 'Cancel' : t(label)),
  );
const dialogOpen = () => document.querySelector('[role="dialog"], [role="alertdialog"]') !== null;
/** A mounted settings page showing a site's GitWorkflow, keyed by site as the settings page keys the Git tab. */
function page(queryClient: () => QueryClient = () => client) {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  hosts.push({ host, root });
  const buttons = () => [...host.querySelectorAll<HTMLButtonElement>('button')];
  const rotateButton = () => buttons().find((item) => item.textContent?.trim() === t('settings.git.workflow.rotateSecret'));
  const tab = {
    host,
    /** The site's Connection panel, keyed by site. */
    open: async (projectId: string, key = `git-${projectId}`) => {
      await act(async () =>
        root.render(
          <QueryClientProvider client={queryClient()}>
            <ConfirmProvider>
              <GitWorkflow key={key} projectId={projectId} />
            </ConfirmProvider>
          </QueryClientProvider>,
        ),
      );
      await settle();
      await act(async () =>
        buttons()
          .find((item) => item.hasAttribute('aria-pressed') && item.textContent?.startsWith(t('settings.git.workflow.nav.connection')))
          ?.click(),
      );
      await settle();
    },
    /** Presses Rotate webhook secret, opening the confirmation. */
    press: async () => {
      await act(async () => rotateButton()?.click());
      await settle();
    },
    busy: () => rotateButton()?.getAttribute('aria-busy') === 'true',
    /** The one-time webhook secret the panel shows, or null. */
    secret: () => {
      const title = [...host.querySelectorAll('[data-slot="alert-title"]')].find(
        (item) => item.textContent === t('settings.git.workflow.copySecret'),
      );
      return title?.parentElement?.querySelector('[data-slot="alert-description"]')?.textContent ?? null;
    },
    unmount: async () => act(async () => root.unmount()),
  };
  return tab;
}
const confirm = async () => {
  await act(async () => dialogButton('settings.git.workflow.rotateSecret')?.click());
  await settle();
};
const cancel = async () => {
  await act(async () => dialogButton('Cancel')?.click());
  await settle();
};
const posts = () => mocks.rotatePost.mock.calls.map(([request]) => request as RotateRequest);
const reads = (projectId: string) => mocks.statusGet.mock.calls.filter(([site]) => site === projectId).length;
const toasts = () => ({ success: mocks.success.mock.calls.map(([message]) => message), error: mocks.error.mock.calls.map(([message]) => message) });

/**
 * Every string reachable from `root`: own properties, enumerable or not (an Error's message, stack and cause), Map and
 * Set entries, and each function's source; cycles walked once.
 */
const reachable = (root: unknown) => {
  const seen = new WeakSet<object>();
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
/**
 * Nothing the QueryClient keeps or hands on holds a placeholder secret: no mutation at all (the rotation is a direct
 * request); no query (its key, options, state, observers) or the session's cache record; neither an all-mutation and
 * all-query dehydration nor the default one (what an offline persister would keep); no console line; no toast.
 */
const expectNothingKept = (queryClient: QueryClient = client) => {
  expect(queryClient.getMutationCache().getAll()).toEqual([]);
  const text = [
    reachable(queryClient.getQueryCache().getAll()),
    reachable(queryClient.getMutationCache().getAll()),
    reachable(sessionOf(queryClient)),
    JSON.stringify(dehydrate(queryClient, { shouldDehydrateMutation: () => true, shouldDehydrateQuery: () => true })),
    JSON.stringify(dehydrate(queryClient)),
    reachable(vi.mocked(console.error).mock.calls),
    reachable(vi.mocked(console.warn).mock.calls),
    reachable(vi.mocked(console.log).mock.calls),
    JSON.stringify(toasts()),
  ].join('\n');
  for (const value of [SECRET_A, SECRET_B, 'test-secret']) expect(text).not.toContain(value);
};

beforeEach(() => {
  held = [];
  onlineManager.setOnline(true);
  client = createQueryClient();
  mocks.statusGet.mockReset().mockImplementation(async (projectId: string) => json(200, { data: status(projectId) }));
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

describe('a rotation asks first, sends the route’s exact request, reads the site back and shows the new secret once', () => {
  it('Cancel sends nothing; a confirmed press sends one empty POST for the site and stays busy while it is held', async () => {
    const tab = page();
    await tab.open('site-a');
    await tab.press();
    expect(dialogOpen()).toBe(true);
    expect(document.body.textContent).toContain(t('settings.git.workflow.rotateConfirm.title'));
    expect(document.body.textContent).toContain(t('settings.git.workflow.rotateConfirm.description'));
    // The destructive confirmation: its confirm button has the destructive variant's own classes.
    expect(dialogButton('settings.git.workflow.rotateSecret')?.className.split(/\s+/)).toContain('text-destructive');
    await cancel();
    expect(posts()).toEqual([]);
    expect(tab.busy()).toBe(false);

    await tab.press();
    await confirm();
    // The route as main calls it: POST /git/webhook-secret for this site, no body or query; the api client adds the
    // session cookie as for every dashboard call.
    expect(posts()).toEqual([{ param: { projectId: 'site-a' } }]);
    expect(Object.keys(posts()[0] ?? {})).toEqual(['param']);
    expect(tab.busy()).toBe(true);
    expect(tab.secret()).toBeNull();
  });

  it('stays busy until the site’s status is read back, then shows the secret once, with no toast', async () => {
    const tab = page();
    await tab.open('site-a');
    await tab.press();
    await confirm();
    const before = reads('site-a');
    const readback = holdNextRead('site-a');
    await answer(0, rotated());
    // The answer is in, the readback is not: still busy, nothing shown yet.
    expect(reads('site-a')).toBe(before + 1);
    expect(tab.busy()).toBe(true);
    expect(tab.secret()).toBeNull();
    await readback.answer();
    expect(tab.busy()).toBe(false);
    expect(tab.secret()).toBe(SECRET_A);
    expect(toasts()).toEqual({ success: [], error: [] });
    expect(posts()).toHaveLength(1);
  });
});

describe('a press belongs to the panel, site and session that made it', () => {
  it('keyed A → B → A while A rotates: B is idle and rotates on its own; A comes back busy; A’s answer refreshes A and shows nowhere', async () => {
    const tab = page();
    await tab.open('site-a');
    await tab.press();
    await confirm();
    await tab.open('site-b');
    expect(tab.busy()).toBe(false);
    await tab.press();
    await confirm();
    expect(posts().map((request) => request.param.projectId)).toEqual(['site-a', 'site-b']);
    await tab.open('site-a');
    expect(tab.busy()).toBe(true);
    // The same-site remount gets no second rotation while the first is in flight.
    await tab.press();
    await confirm();
    expect(posts()).toHaveLength(2);
    const before = reads('site-a');
    await answer(0, rotated(SECRET_A));
    expect(reads('site-a')).toBeGreaterThan(before);
    expect(tab.busy()).toBe(false);
    expect(tab.secret()).toBeNull();
    expect(toasts()).toEqual({ success: [], error: [] });
    await answer(1, rotated(SECRET_B));
    expect(tab.secret()).toBeNull();
  });

  it('leaving while the confirmation is open: confirming it afterwards sends nothing', async () => {
    const tab = page();
    await tab.open('site-a');
    await tab.press();
    expect(dialogOpen()).toBe(true);
    await tab.open('site-b');
    await confirm();
    expect(posts()).toEqual([]);
    expect(tab.busy()).toBe(false);
  });

  it('two dashboards (two QueryClients) on one site: each rotates, reads back and shows only its own secret', async () => {
    const other = createQueryClient();
    const one = page();
    const two = page(() => other);
    await one.open('site-a');
    await two.open('site-a');
    await one.press();
    await confirm();
    expect(two.busy()).toBe(false);
    await two.press();
    await confirm();
    expect(posts()).toHaveLength(2);
    await answer(1, rotated(SECRET_B));
    expect(two.secret()).toBe(SECRET_B);
    expect(one.secret()).toBeNull();
    expect(one.busy()).toBe(true);
    await answer(0, rotated(SECRET_A));
    expect(one.secret()).toBe(SECRET_A);
    expect(two.secret()).toBe(SECRET_B);
  });

  it('programmatic: two panels of one site in one QueryClient confirmed in the same tick send once', async () => {
    const one = page();
    const two = page();
    await one.open('site-a');
    await two.open('site-a');
    await one.press();
    await two.press();
    const dialogs = [...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button, [role="alertdialog"] button')].filter(
      (item) => item.textContent?.trim() === t('settings.git.workflow.rotateSecret'),
    );
    expect(dialogs).toHaveLength(2);
    await act(async () => {
      for (const button of dialogs) button.click();
    });
    await settle();
    expect(posts()).toHaveLength(1);
    expect(one.busy() && two.busy()).toBe(true);
  });

  it('a session reset while the rotation runs: the next session’s panel is idle, and the answer shows or toasts nothing', async () => {
    const tab = page();
    await tab.open('site-a');
    await tab.press();
    await confirm();
    await act(async () => resetDashboardSession(client));
    // AppGuard remounts the dashboard for the next session.
    await tab.open('site-a', 'git-site-a-next-session');
    expect(tab.busy()).toBe(false);
    await answer(0, rotated());
    expect(tab.secret()).toBeNull();
    expect(toasts()).toEqual({ success: [], error: [] });
    expectNothingKept();
  });

  it('a session reset while the confirmation is open: confirming it afterwards sends nothing', async () => {
    const tab = page();
    await tab.open('site-a');
    await tab.press();
    await act(async () => resetDashboardSession(client));
    await tab.open('site-a', 'git-site-a-next-session');
    await confirm();
    expect(posts()).toEqual([]);
  });
});

describe('failures are reported once, sanitized, and never repeated automatically', () => {
  it('a 429 keeps its status, code and a numeric Retry-After, so it still reads as rate limited; one request only', async () => {
    const tab = page();
    await tab.open('site-a');
    await tab.press();
    await confirm();
    await answer(0, json(429, { error: { code: 'http:rate_limited', message: 'Too many requests.' } }, { 'retry-after': '30' }));
    expect(toasts()).toEqual({ success: [], error: [t('error.rateLimited')] });
    const [logged] = vi.mocked(console.error).mock.calls.at(-1) ?? [];
    expect(logged).toMatchObject({ name: 'ApiResponseError', status: 429, code: 'http:rate_limited', retryAfter: '30' });
    expect(posts()).toHaveLength(1);
    expect(tab.busy()).toBe(false);
  });

  it('a refusal keeps a recognized code and drops anything else the server sent, even in non-enumerable fields', async () => {
    const tab = page();
    await tab.open('site-a');
    await tab.press();
    await confirm();
    const echo = `echo ${SECRET_B}`;
    await answer(
      0,
      json(403, { error: { code: echo, message: echo, details: { reason: echo, path: echo, sourceFile: echo } } }, { 'retry-after': echo }),
    );
    expect(toasts().error).toEqual([t('error.noPermission')]);
    const [logged] = vi.mocked(console.error).mock.calls.at(-1) ?? [];
    expect(logged).toMatchObject({ status: 403 });
    expect((logged as { code?: string }).code).toBeUndefined();
    expect((logged as { retryAfter?: string }).retryAfter).toBeUndefined();
    expectNothingKept();

    await tab.press();
    await confirm();
    await answer(1, json(404, { error: { code: 'database:not_found', message: 'git connection not found' } }));
    expect(vi.mocked(console.error).mock.calls.at(-1)?.[0]).toMatchObject({ status: 404, code: 'database:not_found' });
    expect(toasts().error.at(-1)).toBe(t('error.notFound'));
  });

  it('a dropped request (its outcome unknown) reports once and is never sent again until pressed again', async () => {
    const tab = page();
    await tab.open('site-a');
    await tab.press();
    await confirm();
    await drop(0);
    expect(toasts().error).toEqual([t('error.network')]);
    await settle();
    await act(async () => new Promise((done) => setTimeout(done, 50)));
    expect(posts()).toHaveLength(1);
    await tab.press();
    await confirm();
    expect(posts()).toHaveLength(2);
  });

  it('a 500 after the rotation may have been stored is not retried', async () => {
    const tab = page();
    await tab.open('site-a');
    await tab.press();
    await confirm();
    await answer(0, json(500, { error: { code: 'http:internal', message: 'Internal error' } }));
    await act(async () => new Promise((done) => setTimeout(done, 50)));
    expect(posts()).toHaveLength(1);
    expect(toasts().error).toEqual([t('settings.git.workflow.rotateError')]);
  });

  it('offline: the rotation is sent now, nothing is paused or kept for later, and reconnecting sends nothing', async () => {
    const tab = page();
    await tab.open('site-a');
    await act(async () => onlineManager.setOnline(false));
    await tab.press();
    await confirm();
    expect(posts()).toHaveLength(1);
    expect(client.getMutationCache().getAll()).toEqual([]);
    expect(dehydrate(client).mutations).toEqual([]);
    await drop(0);
    await tab.open('site-b');
    await act(async () => onlineManager.setOnline(true));
    await settle();
    expect(posts()).toHaveLength(1);
  });
});

describe('the secret is held only by the request and the panel that shows it', () => {
  it('nothing in the QueryClient, either dehydration or the console holds it: pending, after success, after unmount', async () => {
    const tab = page();
    await tab.open('site-a');
    await tab.press();
    await confirm();
    expectNothingKept();
    await answer(0, rotated());
    expect(tab.secret()).toBe(SECRET_A);
    expectNothingKept();
    await tab.unmount();
    expectNothingKept();
  });
});
