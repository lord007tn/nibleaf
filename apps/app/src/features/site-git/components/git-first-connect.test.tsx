// @vitest-environment jsdom
// Settings → Git → Connect GitHub → step 3, Connect: the first connection of a site. The real GitWorkflow, status
// query, authorization and first-connect request with the app's own QueryClient; only the HTTP calls are replaced
// (every API call is answered here) and a Connect PUT, or a status read, can be held until the test answers it.
// Sites, tokens, secrets and accounts are fictional, low-entropy placeholders.
//
// Which cases ordinary use reaches: presses on the button, Back and edits while Connect runs, a language change,
// a status refetch while it runs, leaving for another site and coming back (the settings page keys the Git tab by
// site: an unmount and a new instance), two sites' tabs at once, a refusal and a retry, offline, and a session change
// (AppGuard remounts the dashboard). Presses in one tick, one instance moved to another site, and a callback or
// instance kept across a session reset are not reachable through the settings page; those tests say "programmatic".
import { ConfirmProvider } from '@nibleaf/design-system/components/ui/confirm';
import { translateFn } from '@nibleaf/i18n';
import { gitConnectionBody } from '@nibleaf/validators';
import { dehydrate, onlineManager, QueryClientProvider } from '@tanstack/react-query';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  locale: 'en' as 'en' | 'ar',
  statusGet: vi.fn(),
  authorizePost: vi.fn(),
  connectionPut: vi.fn(),
  error: vi.fn(),
  success: vi.fn(),
}));
vi.mock('sonner', () => ({ toast: { error: mocks.error, success: mocks.success } }));
vi.mock('@nibleaf/i18n/react', async () => {
  const { translateFn: translate } = await vi.importActual<typeof import('@nibleaf/i18n')>('@nibleaf/i18n');
  return {
    // As the real hook: `t` is bound to the locale it rendered with.
    useLocale: () => {
      const locale = mocks.locale;
      return { locale, t: (key: Parameters<typeof translate>[0], variables?: Parameters<typeof translate>[1]) => translate(key, variables, locale) };
    },
  };
});
vi.mock('@/env', () => ({ env: { VITE_APP_URL: 'https://app.fixture.test' } }));
// Every API call: a status read, an authorization or a connection PUT; anything else fails the test.
vi.mock('@/services/api', () => {
  const answer = (path: string, request: { param?: { projectId?: string } } | undefined) => {
    if (path === 'git.$get') return mocks.statusGet(request?.param?.projectId);
    if (path === 'git.authorize.$post') return mocks.authorizePost(request);
    if (path === 'git.connection.$put') return mocks.connectionPut(request);
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
import { queryKeys } from '@/hooks/api/query-keys';
import { createQueryClient } from '@/integrations/tanstack-query/query-client';
import { resetDashboardSession } from '@/integrations/tanstack-query/session-cache';
import { sessionOf } from '@/integrations/tanstack-query/session-generation';
import { useGitFirstConnectCommand } from './use-git-first-connect-command';

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);

const t = (key: Parameters<typeof translateFn>[0]) => translateFn(key, undefined, mocks.locale);
const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });
/** Fictional placeholders: the tokens are long enough for step 1's 20-character gate and nothing like a provider token. */
const TOKEN_A = 'test-token-0001-placeholder';
const TOKEN_B = 'test-token-0002-placeholder';
const SECRET_A = 'test-secret-0001';
const SECRET_B = 'test-secret-0002';
const ACCOUNT = { login: 'fixture-user', name: 'Fixture User' };

/** Which sites the status reads answer as connected (null otherwise). */
let connected: Record<string, boolean>;
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
type PutRequest = {
  param: { projectId: string };
  json: { repository: string; baseBranch: string; headBranch: string; contentPath: string; token?: string };
};
/** Connection PUTs held until the test answers them, in the order they were sent. */
let held: Array<{ request: PutRequest; resolve: (value: Response) => void; reject: (error: unknown) => void }>;
const answer = async (index: number, response: Response | ((request: PutRequest) => Response)) => {
  const entry = held[index];
  if (!entry) throw new Error(`no held Connect #${index}`);
  await act(async () => entry.resolve(typeof response === 'function' ? response(entry.request) : response));
  await settle();
};
const drop = async (index: number) => {
  await act(async () => held[index]?.reject(new TypeError('Failed to fetch')));
  await settle();
};
/** As `connectGitHub` answers a first connection: the site is connected now, and the one-time secret comes back. */
const stored =
  (secret = SECRET_A) =>
  (request: PutRequest) => {
    connected[request.param.projectId] = true;
    return json(200, { data: { connection: status(request.param.projectId), webhookSecret: secret } });
  };
const refused = () => json(400, { error: { code: 'http:bad_request', message: 'Base branch trunk was not found.' } });
/** A refusal that echoes the token sent, in every field the error format has. */
const echoed = (request: PutRequest) => {
  const echo = `echo ${request.json.token}`;
  return json(
    400,
    { error: { code: echo, message: echo, path: echo, sourceFile: echo, details: { reason: echo, token: request.json.token } } },
    { 'retry-after': echo },
  );
};
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
    answer: async (response: Response = json(200, { data: connected[projectId] ? status(projectId) : null })) => {
      await act(async () => resolve(response));
      await settle();
    },
  };
};

let client: ReturnType<typeof createQueryClient>;
let refreshed: () => unknown[];
const hosts: Array<{ host: HTMLDivElement; root: Root }> = [];
const setValue = async (input: HTMLInputElement | null, value: string) => {
  if (!input) throw new Error('no field');
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
};
/** A mounted settings page showing a site's GitWorkflow, keyed by site as the settings page keys the Git tab. */
function page() {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  hosts.push({ host, root });
  const onConnected = vi.fn();
  const buttons = () => [...host.querySelectorAll<HTMLButtonElement>('button')];
  const button = (label: Parameters<typeof translateFn>[0]) => buttons().find((item) => item.textContent?.trim().startsWith(t(label)));
  const connectButton = () =>
    buttons().find((item) => item.textContent === t('settings.git.workflow.connect') + t('settings.git.workflow.verifying'));
  const press = async (element: HTMLElement | undefined) => {
    if (!element) throw new Error('nothing to press');
    await act(async () => element.click());
    await settle();
  };
  const tab = {
    host,
    onConnected,
    /** The site's panel, keyed by site unless `key` is null (one instance moved: programmatic). */
    open: async (projectId: string, key: string | null = `git-${projectId}`) => {
      await act(async () =>
        root.render(
          <QueryClientProvider client={client}>
            <ConfirmProvider>
              <GitWorkflow key={key ?? undefined} onConnected={onConnected} projectId={projectId} />
            </ConfirmProvider>
          </QueryClientProvider>,
        ),
      );
      await settle();
    },
    /** The wizard step shown (1–3), or null while the wizard is not shown. */
    step: () => {
      const index = [...host.querySelectorAll('ol > li')].findIndex((item) => item.getAttribute('aria-current') === 'step');
      return index === -1 ? null : index + 1;
    },
    connected: () => host.querySelector('nav') !== null,
    connectButton,
    busy: () => connectButton()?.getAttribute('aria-busy') === 'true',
    type: (id: string, value: string) => setValue(host.querySelector<HTMLInputElement>(`#${id}`), value),
    field: (id: string) => host.querySelector<HTMLInputElement>(`#${id}`)?.value ?? null,
    /** Steps 1 and 2 as a person does them, up to the review: authorize `token`, then fill the repository. */
    review: async (token = TOKEN_A, repository = 'acme-fixture/handbook') => {
      await tab.type('git2-token', token);
      await tab.authorize();
      await tab.type('git2-repo', repository);
      await press(button('settings.git.workflow.review'));
      expect(tab.step()).toBe(3);
    },
    connect: async (times = 1) => {
      await act(async () => {
        for (let press = 0; press < times; press += 1) connectButton()?.click();
      });
      await settle();
    },
    authorize: () => press(button('settings.git.workflow.authorize')),
    back: () => press(button('common.back')),
    retryLoad: () => press(button('common.retry')),
    next: () => press(button('settings.git.workflow.review')),
    /** The one-time webhook secret the Connection panel shows, or null. */
    secret: async () => {
      if (tab.connected())
        await press(
          buttons().find((item) => item.hasAttribute('aria-pressed') && item.textContent?.startsWith(t('settings.git.workflow.nav.connection'))),
        );
      const title = [...host.querySelectorAll('[data-slot="alert-title"]')].find(
        (item) => item.textContent === t('settings.git.workflow.copySecret'),
      );
      return title?.parentElement?.querySelector('[data-slot="alert-description"]')?.textContent ?? null;
    },
  };
  return tab;
}
const puts = () => mocks.connectionPut.mock.calls.map(([request]) => request as PutRequest);
const detail = (projectId: string) => queryKeys.gitWorkflow.detail(projectId);
const toasts = () => ({ success: mocks.success.mock.calls.map(([message]) => message), error: mocks.error.mock.calls.map(([message]) => message) });

/**
 * Every string reachable from `root`: own properties, enumerable or not (an Error's message, stack and cause), Map and
 * Set entries, and each function's source; cycles walked once. (A closure's captured values can't be walked; the
 * request keeps none in any of these.)
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
 * Nothing the app keeps or hands on holds a placeholder token or secret: no mutation at all (Connect is a direct
 * request); no query (its key, options, state, observers) or the session's cache record; neither an all-mutation and
 * all-query dehydration nor the default one (what an offline persister would keep); no console line; no toast.
 */
const expectNothingKept = () => {
  expect(client.getMutationCache().getAll()).toEqual([]);
  const text = [
    reachable(client.getQueryCache().getAll()),
    reachable(sessionOf(client)),
    JSON.stringify(dehydrate(client, { shouldDehydrateMutation: () => true, shouldDehydrateQuery: () => true })),
    JSON.stringify(dehydrate(client)),
    reachable(vi.mocked(console.error).mock.calls),
    reachable(vi.mocked(console.warn).mock.calls),
    JSON.stringify(toasts()),
  ].join('\n');
  for (const value of [TOKEN_A, TOKEN_B, SECRET_A, SECRET_B, 'test-token', 'test-secret']) expect(text).not.toContain(value);
};

beforeEach(() => {
  mocks.locale = 'en';
  connected = {};
  held = [];
  client = createQueryClient();
  const invalidate = vi.spyOn(client, 'invalidateQueries');
  refreshed = () => invalidate.mock.calls.map(([filters]) => filters?.queryKey);
  mocks.statusGet.mockReset().mockImplementation(async (projectId: string) => json(200, { data: connected[projectId] ? status(projectId) : null }));
  mocks.authorizePost.mockReset().mockImplementation(async () => json(200, { data: ACCOUNT }));
  mocks.connectionPut.mockReset().mockImplementation(
    (request: PutRequest) =>
      new Promise<Response>((resolve, reject) => {
        held.push({ request, resolve, reject });
      }),
  );
  mocks.error.mockReset();
  mocks.success.mockReset();
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});
afterEach(async () => {
  for (const { host, root } of hosts.splice(0)) {
    await act(async () => root.unmount());
    host.remove();
  }
  vi.restoreAllMocks();
});

describe('a Connect sends the wizard’s values as pressed and shows the new connection with its one-time secret', () => {
  it('sends the raw fields with their defaults, reads back the site, and shows the connected screen and the secret once', async () => {
    const tab = page();
    await tab.open('site-a');
    const raw = `  ${TOKEN_A}  `;
    await tab.review(raw, '  acme-fixture/handbook  ');
    await tab.connect();
    expect(tab.busy()).toBe(true);
    // As main sends it: the fields as typed, the wizard's defaults, the token as typed, and no import targets; and
    // that it expects no connection yet, so one made meanwhile is refused rather than replaced (#876).
    expect(puts()).toEqual([
      {
        param: { projectId: 'site-a' },
        json: {
          repository: '  acme-fixture/handbook  ',
          baseBranch: 'main',
          headBranch: 'nibleaf/docs',
          contentPath: 'docs',
          token: raw,
          expectedRevision: null,
        },
      },
    ]);
    // The server's own validator accepts that exact body: it trims the settings, never the token (connectGitHub then
    // normalizes and stores them; workflow.connect.test.ts runs this body through it).
    expect(gitConnectionBody.parse(puts()[0]?.json)).toEqual({
      repository: 'acme-fixture/handbook',
      baseBranch: 'main',
      headBranch: 'nibleaf/docs',
      contentPath: 'docs',
      token: raw,
      expectedRevision: null,
    });
    expect(refreshed()).toEqual([detail('site-a')]);
    await answer(0, stored());
    expect(refreshed()).toEqual([detail('site-a'), detail('site-a')]);
    expect(tab.connected()).toBe(true);
    expect(toasts()).toEqual({ success: [t('settings.git.workflow.connected')], error: [] });
    expect(tab.onConnected).toHaveBeenCalledTimes(1);
    expect(await tab.secret()).toBe(SECRET_A);
    expect(tab.host.textContent).not.toContain(TOKEN_A);
  });

  it('stays busy until the site’s status is read back, and reports only after that read', async () => {
    const tab = page();
    await tab.open('site-a');
    await tab.review();
    await tab.connect();
    const read = holdNextRead('site-a');
    await answer(0, stored());
    expect(tab.step()).toBe(3);
    expect(tab.busy()).toBe(true);
    expect([toasts().success, tab.onConnected.mock.calls.length]).toEqual([[], 0]);
    await read.answer();
    expect(tab.connected()).toBe(true);
    expect(tab.onConnected).toHaveBeenCalledTimes(1);
    expect(await tab.secret()).toBe(SECRET_A);
  });

  it('a status refetch while Connect runs: the connected screen it brings is still this Connect’s screen', async () => {
    const tab = page();
    await tab.open('site-a');
    await tab.review();
    await tab.connect();
    // The server stored the connection; a refresh shows it before the PUT's answer arrives.
    connected['site-a'] = true;
    await act(async () => client.invalidateQueries({ queryKey: detail('site-a') }));
    await settle();
    expect(tab.connected()).toBe(true);
    await answer(0, stored());
    expect(toasts().success).toEqual([t('settings.git.workflow.connected')]);
    expect(tab.onConnected).toHaveBeenCalledTimes(1);
    expect(await tab.secret()).toBe(SECRET_A);
  });

  it('a readback that fails still reports the connection, and the secret shows once the status loads', async () => {
    const tab = page();
    await tab.open('site-a');
    await tab.review();
    await tab.connect();
    const read = holdNextRead('site-a');
    await answer(0, stored());
    // A 4xx, which the app's QueryClient does not retry.
    await read.answer(json(403, { error: { message: 'No access.' } }));
    expect(tab.step()).toBe(null);
    expect(tab.onConnected).toHaveBeenCalledTimes(1);
    expect(toasts().success).toEqual([t('settings.git.workflow.connected')]);
    await tab.retryLoad();
    expect(tab.connected()).toBe(true);
    expect(await tab.secret()).toBe(SECRET_A);
  });

  it('a language change while Connect runs keeps it, and reports in the new language', async () => {
    const tab = page();
    await tab.open('site-a');
    await tab.review();
    await tab.connect();
    mocks.locale = 'ar';
    await tab.open('site-a');
    expect(tab.busy()).toBe(true);
    await answer(0, stored());
    expect(toasts().success).toEqual([translateFn('settings.git.workflow.connected', undefined, 'ar')]);
    expect(await tab.secret()).toBe(SECRET_A);
  });
});

describe('a press belongs to the wizard that made it', () => {
  it('programmatic: presses in one tick send once; a press while busy sends nothing', async () => {
    const tab = page();
    await tab.open('site-a');
    await tab.review();
    await tab.connect(3);
    expect(puts()).toHaveLength(1);
    await act(async () => tab.connectButton()?.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    expect(puts()).toHaveLength(1);
    await answer(0, stored());
    expect(tab.onConnected).toHaveBeenCalledTimes(1);
  });

  it('Back and edits while Connect runs: the body pressed is sent, and its success still shows the connection', async () => {
    const tab = page();
    await tab.open('site-a');
    await tab.review();
    await tab.connect();
    await tab.back();
    await tab.type('git2-repo', 'acme-fixture/other');
    expect(puts().map((request) => request.json.repository)).toEqual(['acme-fixture/handbook']);
    await answer(0, stored());
    expect(tab.connected()).toBe(true);
    expect(tab.onConnected).toHaveBeenCalledTimes(1);
    expect(await tab.secret()).toBe(SECRET_A);
  });

  it('a success the status does not confirm keeps a token typed since the press, and its check', async () => {
    const tab = page();
    await tab.open('site-a');
    await tab.review();
    await tab.connect();
    await tab.back();
    await tab.back();
    await tab.type('git2-token', TOKEN_B);
    // The PUT succeeds, but the status read after it still says not connected (another person disconnected).
    await answer(0, (request) => json(200, { data: { connection: status(request.param.projectId), webhookSecret: SECRET_A } }));
    expect(tab.step()).toBe(1);
    expect(tab.field('git2-token')).toBe(TOKEN_B);
    expect(tab.onConnected).toHaveBeenCalledTimes(1);
  });

  it('a success with the token unchanged clears it and its check, as main did', async () => {
    const tab = page();
    await tab.open('site-a');
    await tab.review();
    await tab.connect();
    await answer(0, (request) => json(200, { data: { connection: status(request.param.projectId), webhookSecret: SECRET_A } }));
    expect(tab.step()).toBe(3);
    expect(tab.connectButton()?.disabled).toBe(true);
    await tab.back();
    await tab.back();
    expect(tab.field('git2-token')).toBe('');
  });

  it('a refusal after Back and edits reports once and keeps every value typed; a retry sends the values now', async () => {
    const tab = page();
    await tab.open('site-a');
    await tab.review();
    await tab.connect();
    await tab.back();
    await tab.type('git2-path', 'guides');
    await answer(0, refused());
    expect(toasts()).toEqual({ success: [], error: [t('settings.git.workflow.connectError')] });
    expect([tab.step(), tab.field('git2-repo'), tab.field('git2-path')]).toEqual([2, 'acme-fixture/handbook', 'guides']);
    await tab.next();
    expect(tab.busy()).toBe(false);
    await tab.connect();
    expect(puts().map((request) => request.json.contentPath)).toEqual(['docs', 'guides']);
    expect(puts()[1]?.json.token).toBe(TOKEN_A);
  });

  it('a conflict (someone else connected meanwhile) refreshes the status and says their save is shown (#915)', async () => {
    const tab = page();
    await tab.open('site-a');
    await tab.review();
    await tab.connect();
    expect(puts()[0]?.json).toMatchObject({ expectedRevision: null });
    const reads = mocks.statusGet.mock.calls.length;
    // Another person's first Connect committed while this one was in flight: the server refuses this one (409).
    connected['site-a'] = true;
    await answer(0, json(409, { error: { code: 'http:conflict', message: 'The connection settings changed.' } }));
    expect(mocks.statusGet.mock.calls.length).toBeGreaterThan(reads);
    expect(toasts()).toEqual({ success: [], error: [t('settings.git.workflow.savedElsewhere')] });
    // The refreshed status shows the other connection in place of the wizard, without a reload.
    expect([tab.step(), tab.connected()]).toEqual([null, true]);
    expect(tab.onConnected).not.toHaveBeenCalled();
    expect(await tab.secret()).toBeNull();
  });

  it('keyed A → B → A while A connects: B is independent; A comes back busy, then reads A back and reports nowhere', async () => {
    const tab = page();
    await tab.open('site-a');
    await tab.review();
    await tab.connect();
    await tab.open('site-b');
    await tab.review();
    expect(tab.busy()).toBe(false);
    await tab.connect();
    expect(puts().map((request) => request.param.projectId)).toEqual(['site-a', 'site-b']);
    await answer(1, stored(SECRET_B));
    expect(await tab.secret()).toBe(SECRET_B);
    await tab.open('site-a');
    await tab.review();
    expect(tab.busy()).toBe(true);
    await tab.connect();
    expect(puts()).toHaveLength(2);
    const before = tab.onConnected.mock.calls.length;
    const reads = refreshed().length;
    await answer(0, stored());
    expect(refreshed().slice(reads)).toEqual([detail('site-a')]);
    expect(tab.connected()).toBe(true);
    expect(tab.onConnected).toHaveBeenCalledTimes(before);
    expect(toasts().success).toEqual([t('settings.git.workflow.connected')]);
    expect(await tab.secret()).toBe(null);
  });

  it('after leaving (keyed), a late refusal is reported nowhere, and the site is ready again', async () => {
    const tab = page();
    await tab.open('site-a');
    await tab.review();
    await tab.connect();
    await tab.open('site-b');
    await answer(0, refused());
    await tab.open('site-a');
    await tab.review();
    expect(tab.busy()).toBe(false);
    expect(toasts().error).toEqual([]);
    // Each verification refreshes its site; the refusal refreshes nothing.
    expect(refreshed()).toEqual([detail('site-a'), detail('site-a')]);
  });

  it('two sites’ wizards at once: each connects, reads back and shows its own secret', async () => {
    const first = page();
    const second = page();
    await first.open('site-a');
    await second.open('site-b');
    await first.review();
    await second.review(TOKEN_B);
    await first.connect();
    await second.connect();
    expect([first.busy(), second.busy()]).toEqual([true, true]);
    await answer(1, stored(SECRET_B));
    expect([first.busy(), second.connected()]).toEqual([true, true]);
    await answer(0, stored(SECRET_A));
    expect([await first.secret(), await second.secret()]).toEqual([SECRET_A, SECRET_B]);
    expect([first.onConnected.mock.calls.length, second.onConnected.mock.calls.length]).toEqual([1, 1]);
  });

  it('programmatic: one instance moved from site A to B ignores A’s answer, refreshes A only, and is idle for B', async () => {
    const tab = page();
    await tab.open('site-a', null);
    await tab.review();
    await tab.connect();
    await tab.open('site-b', null);
    await answer(0, stored());
    expect(refreshed().at(-1)).toEqual(detail('site-a'));
    expect([toasts().success, tab.onConnected.mock.calls.length, await tab.secret()]).toEqual([[], 0, null]);
    expect(tab.busy()).toBe(false);
  });
});

describe('a session that ends gets nothing from a Connect', () => {
  it('a session reset while Connect runs: the next session’s wizard is ready, and the answer reads back and reports nothing', async () => {
    const tab = page();
    await tab.open('site-a');
    await tab.review();
    await tab.connect();
    await act(async () => resetDashboardSession(client));
    await tab.open('site-a', 'git-site-a-next-session');
    await tab.review();
    expect(tab.busy()).toBe(false);
    const reads = mocks.statusGet.mock.calls.length;
    const refreshes = refreshed().length;
    await answer(0, stored());
    expect(mocks.statusGet.mock.calls.length).toBe(reads);
    expect(refreshed()).toHaveLength(refreshes);
    expect([toasts(), tab.onConnected.mock.calls.length, tab.step()]).toEqual([{ success: [], error: [] }, 0, 3]);
    expectNothingKept();
  });

  it('a session reset after the answer arrives, before its body is read: nothing is read back or reported', async () => {
    const tab = page();
    await tab.open('site-a');
    await tab.review();
    await tab.connect();
    let body: (value: unknown) => void = () => undefined;
    const response = {
      ok: true,
      status: 200,
      headers: new Headers(),
      json: () =>
        new Promise((done) => {
          body = done;
        }),
    } as unknown as Response;
    await answer(0, response);
    await act(async () => resetDashboardSession(client));
    await act(async () => body({ data: { connection: status('site-a'), webhookSecret: SECRET_A } }));
    await settle();
    expect(refreshed()).toEqual([detail('site-a')]);
    expect([toasts(), tab.onConnected.mock.calls.length]).toEqual([{ success: [], error: [] }, 0]);
    expectNothingKept();
  });

  it('a session reset while the success is read back: nothing is reported', async () => {
    const tab = page();
    await tab.open('site-a');
    await tab.review();
    await tab.connect();
    const read = holdNextRead('site-a');
    await answer(0, stored());
    await act(async () => resetDashboardSession(client));
    await read.answer();
    expect([toasts(), tab.onConnected.mock.calls.length]).toEqual([{ success: [], error: [] }, 0]);
  });

  it('programmatic: a press kept from before a session reset, or the old instance pressed after it, sends nothing', async () => {
    let press: ((body: PutRequest['json']) => void) | undefined;
    function Probe() {
      press = useGitFirstConnectCommand('site-a', { connected: () => undefined, failed: () => undefined }).press;
      return null;
    }
    const host = document.createElement('div');
    const root = createRoot(host);
    hosts.push({ host, root });
    await act(async () =>
      root.render(
        <QueryClientProvider client={client}>
          <Probe />
        </QueryClientProvider>,
      ),
    );
    const kept = press;
    await act(async () => resetDashboardSession(client));
    kept?.({ repository: 'acme-fixture/handbook', baseBranch: 'main', headBranch: 'nibleaf/docs', contentPath: 'docs', token: TOKEN_A });
    await settle();
    expect(puts()).toEqual([]);

    const tab = page();
    await tab.open('site-b');
    await tab.review();
    await act(async () => resetDashboardSession(client));
    await act(async () => tab.connectButton()?.click());
    await settle();
    expect(puts()).toEqual([]);
    expect(toasts()).toEqual({ success: [], error: [] });
    expectNothingKept();
  });
});

describe('failures', () => {
  it('a refusal reports once with the existing message, keeps the wizard, refreshes nothing, and a retry connects', async () => {
    const tab = page();
    await tab.open('site-a');
    await tab.review();
    await tab.connect();
    await answer(0, refused());
    expect(toasts()).toEqual({ success: [], error: [t('settings.git.workflow.connectError')] });
    expect([tab.step(), tab.busy(), tab.connectButton()?.disabled]).toEqual([3, false, false]);
    expect(refreshed()).toEqual([detail('site-a')]);
    await tab.connect();
    expect(puts().map((request) => request.json)).toEqual([puts()[0]?.json, puts()[0]?.json]);
    await answer(1, stored());
    expect(tab.connected()).toBe(true);
    expect(await tab.secret()).toBe(SECRET_A);
  });

  it('offline: the Connect is sent now and never replayed; a dropped request reports once and a press retries it', async () => {
    const tab = page();
    await tab.open('site-a');
    await tab.review();
    try {
      await act(async () => onlineManager.setOnline(false));
      await tab.connect();
      expect(puts()).toHaveLength(1);
      expectNothingKept();
      await drop(0);
      expect(toasts().error).toEqual([t('error.network')]);
      expect(tab.busy()).toBe(false);
      expectNothingKept();
    } finally {
      await act(async () => onlineManager.setOnline(true));
      await settle();
    }
    expect(puts()).toHaveLength(1);
    await tab.connect();
    expect(puts()).toHaveLength(2);
  });

  it('a 429 keeps the status and a numeric Retry-After, so it still reads as rate limited', async () => {
    const tab = page();
    await tab.open('site-a');
    await tab.review();
    await tab.connect();
    await answer(0, json(429, { error: { code: 'rate:limited', message: 'slow down' } }, { 'retry-after': '30' }));
    expect(toasts().error).toEqual([t('error.rateLimited')]);
    const error = vi
      .mocked(console.error)
      .mock.calls.flat()
      .find((item) => item instanceof Error);
    expect(error).toMatchObject({ status: 429, retryAfter: '30', code: undefined, details: undefined });
  });
});

describe('neither the token nor the one-time secret is kept by the QueryClient, the console or a toast', () => {
  it('at the press, while pending, after the success and its secret, after unmount and after a session reset', async () => {
    const tab = page();
    await tab.open('site-a');
    await tab.review();
    expectNothingKept();
    await tab.connect();
    expectNothingKept();
    await answer(0, stored());
    expect(await tab.secret()).toBe(SECRET_A);
    expectNothingKept();
    const mounted = hosts.pop();
    await act(async () => mounted?.root.unmount());
    mounted?.host.remove();
    expectNothingKept();
    await act(async () => resetDashboardSession(client));
    expectNothingKept();
  });

  it('after a refusal that echoes the token in every field, a correction, and a retry that stores another secret', async () => {
    const tab = page();
    await tab.open('site-a');
    await tab.review();
    await tab.connect();
    await answer(0, echoed);
    expect(toasts().error).toEqual([t('settings.git.workflow.connectError')]);
    const error = vi
      .mocked(console.error)
      .mock.calls.flat()
      .find((item) => item instanceof Error);
    expect(error).toMatchObject({ status: 400, code: undefined, retryAfter: undefined, details: undefined, path: undefined });
    expect(tab.host.textContent).not.toContain(TOKEN_A);
    expectNothingKept();
    await tab.back();
    await tab.back();
    await tab.type('git2-token', TOKEN_B);
    expectNothingKept();
    await tab.authorize();
    await tab.next();
    await tab.connect();
    expect(puts()[1]?.json.token).toBe(TOKEN_B);
    expectNothingKept();
    await answer(1, stored(SECRET_B));
    expect(await tab.secret()).toBe(SECRET_B);
    expectNothingKept();
  });
});
