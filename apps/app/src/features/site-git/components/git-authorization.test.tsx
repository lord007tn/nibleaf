// @vitest-environment jsdom
// Settings → Git → Connect GitHub → step 1, Authorize GitHub. The real GitWorkflow, status query and authorization
// request with the app's own QueryClient; only the HTTP calls are replaced (every API call is answered here) and an
// authorization POST can be held until the test answers it. Sites, tokens and accounts are fictional placeholders.
//
// Which cases ordinary use reaches: presses in the same tick or later, editing the token while a check runs (A → B,
// A → B → A), a language change, a status refetch that fails or finds the site connected, leaving for another site
// and coming back (the settings page keys the Git tab by site, so that is an unmount and a new instance), two sites'
// tabs at once, and a session change (AppGuard remounts the dashboard). One instance moved to another site, and a
// status reset back to its first load, are not reachable through the settings page; those tests are marked
// "programmatic".
import { ConfirmProvider } from '@nibleaf/design-system/components/ui/confirm';
import { translateFn } from '@nibleaf/i18n';
import { gitAuthorizationBody } from '@nibleaf/validators';
import { dehydrate, onlineManager, QueryClientProvider } from '@tanstack/react-query';
import { act, type ReactNode, useLayoutEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  locale: 'en' as 'en' | 'ar',
  authorizePost: vi.fn(),
  statusGet: vi.fn(),
  error: vi.fn(),
  success: vi.fn(),
}));
vi.mock('sonner', () => ({ toast: { error: mocks.error, success: mocks.success } }));
vi.mock('@nibleaf/i18n/react', async () => {
  const { translateFn: translate } = await vi.importActual<typeof import('@nibleaf/i18n')>('@nibleaf/i18n');
  const t = (key: Parameters<typeof translate>[0], variables?: Parameters<typeof translate>[1]) => translate(key, variables, mocks.locale);
  return { useT: () => t, useLocale: () => ({ locale: mocks.locale, t }) };
});
vi.mock('@/env', () => ({ env: { VITE_APP_URL: 'https://app.fixture.test' } }));
// Every API call: the status read goes to `mocks.statusGet`, an authorization to `mocks.authorizePost`.
vi.mock('@/services/api', () => {
  const answer = (path: string, request: { param?: { projectId?: string } } | undefined) => {
    if (path === 'git.$get') return mocks.statusGet(request?.param?.projectId);
    if (path === 'git.authorize.$post') return mocks.authorizePost(request);
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
import { useGitAuthorizationCommand } from './use-git-authorization-command';

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);

const t = (key: Parameters<typeof translateFn>[0]) => translateFn(key, undefined, mocks.locale);
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
/** Fictional placeholders, long enough for the button's 20-character gate and nothing like a provider token. */
const TOKEN_A = 'test-token-0001-placeholder';
const TOKEN_B = 'test-token-0002-placeholder';
const ACCOUNT_A = { login: 'fixture-user-a', name: 'Fixture User A' };
const ACCOUNT_B = { login: 'fixture-user-b', name: null };
const accountFor = (token: string) => (token === TOKEN_B ? ACCOUNT_B : ACCOUNT_A);

/** What each site's status read answers: not connected (null) unless a test connects it. */
let connected: Record<string, boolean>;
const status = (projectId: string) => ({
  id: `connection-${projectId}`,
  repository: `acme-fixture/${projectId}`,
  baseBranch: 'main',
  headBranch: 'nibleaf/docs',
  contentPath: 'docs',
  credentialConfigured: true,
  webhookConfigured: true,
  lastSyncStatus: 'READY',
  lastSyncError: null,
  lastSyncedAt: '2026-11-15T09:00:00.000Z',
  operations: [],
  pullRequests: [],
  files: [],
});

/** Lets mutations and queries settle: TanStack tells React on a timer, so each tick gets its own act. */
const settle = async () => {
  for (let tick = 0; tick < 4; tick += 1) await act(async () => new Promise((done) => setTimeout(done, 0)));
};
type AuthorizeRequest = { param: { projectId: string }; json: { token: string } };
/** Authorization POSTs held until the test answers them, in the order they were sent. */
let held: Array<{ request: AuthorizeRequest; resolve: (value: Response) => void; reject: (error: unknown) => void }>;
const answer = async (index: number, response: Response | ((request: AuthorizeRequest) => Response)) => {
  const entry = held[index];
  if (!entry) throw new Error(`no held authorization #${index}`);
  await act(async () => entry.resolve(typeof response === 'function' ? response(entry.request) : response));
  await settle();
};
const verified = (request: AuthorizeRequest) => json(200, { data: accountFor(request.json.token) });
const refused = () => json(400, { error: { code: 'BAD_REQUEST', message: 'GitHub rejected the token.' } });

let client: ReturnType<typeof createQueryClient>;
let refreshed: () => unknown[];
const hosts: Array<{ host: HTMLDivElement; root: Root }> = [];
/** A mounted settings page showing a site's GitWorkflow, keyed by site as the settings page keys the Git tab. */
function page() {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  hosts.push({ host, root });
  const render = async (node: ReactNode) => {
    await act(async () =>
      root.render(
        <QueryClientProvider client={client}>
          <ConfirmProvider>{node}</ConfirmProvider>
        </QueryClientProvider>,
      ),
    );
    await settle();
  };
  const input = () => host.querySelector<HTMLInputElement>('#git2-token');
  const verify = () =>
    [...host.querySelectorAll<HTMLButtonElement>('button')].find(
      (item) =>
        item.textContent?.includes(t('settings.git.workflow.authorize')) || item.textContent?.includes(t('settings.git.workflow.authorizing')),
    );
  const button = (label: Parameters<typeof translateFn>[0]) =>
    [...host.querySelectorAll<HTMLButtonElement>('button')].find((item) => item.textContent?.includes(t(label)));
  return {
    host,
    /** The site's panel, keyed by site unless `key` is null (one instance moved: programmatic). */
    open: (projectId: string, key: string | null = `git-${projectId}`) => render(<GitWorkflow key={key ?? undefined} projectId={projectId} />),
    input,
    verify,
    button,
    /** The connect page's progress: null while it is not shown, 1 until the token is checked, 2 once its account shows. */
    step: () => {
      if (!host.querySelector('[data-slot="git-connect"]')) return null;
      const checked = [...host.querySelectorAll('span')].some((span) => span.textContent?.startsWith(t('settings.git.workflow.authorizedAs')));
      return checked ? 2 : 1;
    },
    /** The inline refusal under the token. */
    error: () => [...host.querySelectorAll('p')].filter((p) => p.textContent === t('settings.git.workflow.authorizeError')).length,
    busy: () => verify()?.getAttribute('aria-busy') === 'true',
    /** Types the token as a person would (React's value tracker sees the change). */
    type: async (value: string) => {
      const field = input();
      if (!field) throw new Error('no token field');
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
      await act(async () => {
        setter?.call(field, value);
        field.dispatchEvent(new Event('input', { bubbles: true }));
      });
    },
    press: async (times = 1) => {
      await act(async () => {
        for (let press = 0; press < times; press += 1) verify()?.click();
      });
      await settle();
    },
    /** Fills in the repository, so Connect is the next press. */
    review: async () => {
      const repository = host.querySelector<HTMLInputElement>('#git2-repo');
      if (!repository) throw new Error('no repository field');
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
      await act(async () => {
        setter?.call(repository, 'acme-fixture/handbook');
        repository.dispatchEvent(new Event('input', { bubbles: true }));
      });
      await settle();
    },
    /** The account the review shows ("authorized as @login · name"), or null. */
    account: () => {
      const line = [...host.querySelectorAll('span')].find((span) => span.textContent?.startsWith(t('settings.git.workflow.authorizedAs')));
      return line?.textContent ?? null;
    },
  };
}
const posts = () => mocks.authorizePost.mock.calls.map(([request]) => request as AuthorizeRequest);
const detail = (projectId: string) => queryKeys.gitWorkflow.detail(projectId);
const authorizedAs = (account: { login: string; name: string | null }) =>
  `${t('settings.git.workflow.authorizedAs')} @${account.login}${account.name ? ` · ${account.name}` : ''}`;

beforeEach(() => {
  mocks.locale = 'en';
  connected = {};
  held = [];
  client = createQueryClient();
  const invalidate = vi.spyOn(client, 'invalidateQueries');
  refreshed = () => invalidate.mock.calls.map(([filters]) => filters?.queryKey);
  mocks.statusGet.mockReset().mockImplementation(async (projectId: string) => json(200, { data: connected[projectId] ? status(projectId) : null }));
  mocks.authorizePost.mockReset().mockImplementation(
    (request: AuthorizeRequest) =>
      new Promise<Response>((resolve, reject) => {
        held.push({ request, resolve, reject });
      }),
  );
  mocks.error.mockReset();
  mocks.success.mockReset();
});
afterEach(async () => {
  for (const { host, root } of hosts.splice(0)) {
    await act(async () => root.unmount());
    host.remove();
  }
});

describe('the connect page', () => {
  it('shows how to make the token, and says next to Connect what it is waiting for', async () => {
    const tab = page();
    await tab.open('site-a');
    const create = [...tab.host.querySelectorAll('a')].find((link) => link.textContent?.includes(t('settings.git.connect.createToken')));
    expect(create?.getAttribute('href')).toBe('https://github.com/settings/personal-access-tokens/new');
    expect(create?.getAttribute('target')).toBe('_blank');
    for (const permission of ['contents', 'pullRequests', 'metadata'] as const) {
      expect(tab.host.textContent).toContain(t(`settings.git.connect.permission.${permission}`));
    }
    const connect = () => tab.button('settings.git.workflow.connect');
    const reason = () => tab.host.querySelector('#git2-connect-reason')?.textContent ?? null;
    expect([connect()?.disabled, reason()]).toEqual([true, t('settings.git.connect.checkFirst')]);
    expect(connect()?.getAttribute('aria-describedby')).toBe('git2-connect-reason');
    await tab.type(TOKEN_A);
    await tab.press();
    await answer(0, verified);
    expect([connect()?.disabled, reason()]).toEqual([true, t('settings.git.connect.repositoryFirst')]);
    await tab.review();
    expect([connect()?.disabled, reason()]).toEqual([false, null]);
  });
});

describe('a verification sends the token as typed and reports into the wizard', () => {
  it('sends the raw token for the site, refreshes that site, and goes on to step 2 with the account', async () => {
    const tab = page();
    await tab.open('site-a');
    expect(tab.step()).toBe(1);
    const raw = `  ${TOKEN_A}  `;
    await tab.type(raw);
    await tab.press();
    expect(tab.busy()).toBe(true);
    expect(posts()).toEqual([{ param: { projectId: 'site-a' }, json: { token: raw } }]);
    // The server's own validator accepts it unchanged: no trimming or defaulting on the way.
    expect(gitAuthorizationBody.parse(posts()[0]?.json)).toEqual({ token: raw });
    expect(tab.step()).toBe(1);
    await answer(0, json(200, { data: ACCOUNT_A }));
    expect(refreshed()).toEqual([detail('site-a')]);
    expect(tab.step()).toBe(2);
    await tab.review();
    expect(tab.step()).toBe(2);
    expect(tab.account()).toBe(authorizedAs(ACCOUNT_A));
    // Kept for the final Connect request.
    expect(tab.button('settings.git.workflow.connect')?.disabled).toBe(false);
    expect(mocks.error).not.toHaveBeenCalled();
    expect(mocks.success).not.toHaveBeenCalled();
  });

  it('keeps the minimum-length gate on the trimmed token', async () => {
    const tab = page();
    await tab.open('site-a');
    await tab.type(`   ${'x'.repeat(19)}   `);
    expect(tab.verify()?.disabled).toBe(true);
    await tab.type('x'.repeat(20));
    expect(tab.verify()?.disabled).toBe(false);
  });

  it('keeps the token after a refusal, shows the error once, refreshes nothing, and retries with the same body', async () => {
    const tab = page();
    await tab.open('site-a');
    await tab.type(TOKEN_A);
    await tab.press();
    await answer(0, refused());
    expect(tab.step()).toBe(1);
    expect(tab.input()?.value).toBe(TOKEN_A);
    expect(tab.error()).toBe(1);
    expect(tab.busy()).toBe(false);
    expect(refreshed()).toEqual([]);
    expect(mocks.error).not.toHaveBeenCalled();
    // The retry hides the old refusal while it runs, and succeeds.
    await tab.press();
    expect(tab.error()).toBe(0);
    expect(tab.busy()).toBe(true);
    expect(posts().map((request) => request.json)).toEqual([{ token: TOKEN_A }, { token: TOKEN_A }]);
    await answer(1, verified);
    expect(tab.step()).toBe(2);
    expect(refreshed()).toEqual([detail('site-a')]);
  });

  it('does not retry a dropped request, and reports it inline', async () => {
    const tab = page();
    await tab.open('site-a');
    await tab.type(TOKEN_A);
    await tab.press();
    const entry = held[0];
    if (!entry) throw new Error('no request');
    await act(async () => entry.reject(new TypeError('Failed to fetch')));
    await settle();
    expect(posts()).toHaveLength(1);
    expect(tab.error()).toBe(1);
    expect(tab.input()?.value).toBe(TOKEN_A);
    expect(mocks.error).not.toHaveBeenCalled();
  });

  it('asks for a new check once the checked token is edited', async () => {
    const tab = page();
    await tab.open('site-a');
    await tab.type(TOKEN_A);
    await tab.press();
    await answer(0, verified);
    expect(tab.step()).toBe(2);
    await tab.type(`${TOKEN_A} `);
    expect(tab.step()).toBe(1);
    await tab.press();
    expect(posts()).toHaveLength(2);
    await answer(1, verified);
    expect(tab.step()).toBe(2);
  });
});

describe('one current verification per wizard', () => {
  it('sends once for presses in the same tick, busy until the answer', async () => {
    const tab = page();
    await tab.open('site-a');
    await tab.type(TOKEN_A);
    await tab.press(3);
    expect(posts()).toHaveLength(1);
    expect(tab.busy()).toBe(true);
    await answer(0, verified);
    expect(tab.step()).toBe(2);
    expect(posts()).toHaveLength(1);
  });

  it('keeps two sites’ wizards independent: each verifies, refreshes and advances on its own', async () => {
    const a = page();
    const b = page();
    await a.open('site-a');
    await b.open('site-b');
    await a.type(TOKEN_A);
    await b.type(TOKEN_B);
    await a.press();
    expect(b.busy()).toBe(false);
    await b.press();
    expect(posts().map((request) => request.param.projectId)).toEqual(['site-a', 'site-b']);
    await answer(1, verified);
    expect([a.step(), b.step()]).toEqual([1, 2]);
    expect(a.busy()).toBe(true);
    await answer(0, refused());
    expect([a.step(), a.error(), b.error()]).toEqual([1, 1, 0]);
    expect(refreshed()).toEqual([detail('site-b')]);
  });
});

describe('a verification reports only into the token and wizard it checked', () => {
  it('A held → typed B → A verified: stays on step 1 with B, no account, and B can be checked', async () => {
    const tab = page();
    await tab.open('site-a');
    await tab.type(TOKEN_A);
    await tab.press();
    await tab.type(TOKEN_B);
    expect(tab.busy()).toBe(false);
    await answer(0, verified);
    // The request still completes for its site: its success refreshes site A.
    expect(refreshed()).toEqual([detail('site-a')]);
    expect(tab.step()).toBe(1);
    expect(tab.input()?.value).toBe(TOKEN_B);
    expect(tab.error()).toBe(0);
    await tab.press();
    expect(posts().map((request) => request.json.token)).toEqual([TOKEN_A, TOKEN_B]);
    await answer(1, verified);
    expect(tab.step()).toBe(2);
    await tab.review();
    expect(tab.account()).toBe(authorizedAs(ACCOUNT_B));
  });

  it('A held → B → A: the edit retired the check, so its answer does not advance', async () => {
    const tab = page();
    await tab.open('site-a');
    await tab.type(TOKEN_A);
    await tab.press();
    await tab.type(TOKEN_B);
    await tab.type(TOKEN_A);
    expect(tab.busy()).toBe(false);
    await answer(0, verified);
    expect(tab.step()).toBe(1);
    expect(tab.input()?.value).toBe(TOKEN_A);
    expect(posts()).toHaveLength(1);
  });

  it('a later check is neither released nor reported by an earlier one', async () => {
    const tab = page();
    await tab.open('site-a');
    await tab.type(TOKEN_A);
    await tab.press();
    await tab.type(TOKEN_B);
    await tab.press();
    expect(posts().map((request) => request.json.token)).toEqual([TOKEN_A, TOKEN_B]);
    // A's success: B's check is still current and busy.
    await answer(0, verified);
    expect(tab.busy()).toBe(true);
    expect(tab.step()).toBe(1);
    await answer(1, verified);
    expect(tab.step()).toBe(2);
    await tab.review();
    expect(tab.account()).toBe(authorizedAs(ACCOUNT_B));
  });

  it('a later check is not reported failed by an earlier refusal', async () => {
    const tab = page();
    await tab.open('site-a');
    await tab.type(TOKEN_A);
    await tab.press();
    await tab.type(TOKEN_B);
    await tab.press();
    await answer(0, refused());
    expect(tab.error()).toBe(0);
    expect(tab.busy()).toBe(true);
    await answer(1, verified);
    expect(tab.step()).toBe(2);
  });

  it('an old refusal after a correction shows nothing', async () => {
    const tab = page();
    await tab.open('site-a');
    await tab.type(TOKEN_A);
    await tab.press();
    await tab.type(TOKEN_B);
    await answer(0, refused());
    expect(tab.error()).toBe(0);
    expect(tab.step()).toBe(1);
    expect(tab.input()?.value).toBe(TOKEN_B);
  });

  it('editing the token clears a refusal of the old one', async () => {
    const tab = page();
    await tab.open('site-a');
    await tab.type(TOKEN_A);
    await tab.press();
    await answer(0, refused());
    expect(tab.error()).toBe(1);
    await tab.type(TOKEN_B);
    expect(tab.error()).toBe(0);
  });

  it('stays current through a language change', async () => {
    const tab = page();
    await tab.open('site-a');
    await tab.type(TOKEN_A);
    await tab.press();
    mocks.locale = 'ar';
    await tab.open('site-a');
    expect(tab.busy()).toBe(true);
    expect(tab.verify()?.textContent).toContain(t('settings.git.workflow.authorizing'));
    await answer(0, verified);
    expect(tab.step()).toBe(2);
    expect(posts()).toHaveLength(1);
  });

  it('after leaving for another site and back (keyed), the new wizards are idle, start fresh and ignore the answer', async () => {
    const tab = page();
    await tab.open('site-a');
    await tab.type(TOKEN_A);
    await tab.press();
    await tab.open('site-b');
    expect([tab.step(), tab.busy(), tab.input()?.value]).toEqual([1, false, '']);
    await tab.open('site-a');
    expect([tab.step(), tab.busy(), tab.input()?.value]).toEqual([1, false, '']);
    // The new wizard does not wait for the departed one.
    await tab.type(TOKEN_B);
    await tab.press();
    expect(posts()).toHaveLength(2);
    await answer(0, verified);
    expect(tab.step()).toBe(1);
    expect(tab.busy()).toBe(true);
    expect(refreshed()).toEqual([detail('site-a')]);
    await answer(1, verified);
    expect(tab.step()).toBe(2);
    await tab.review();
    expect(tab.account()).toBe(authorizedAs(ACCOUNT_B));
  });

  it('after leaving (keyed), a late refusal is reported nowhere', async () => {
    const tab = page();
    await tab.open('site-a');
    await tab.type(TOKEN_A);
    await tab.press();
    await tab.open('site-b');
    await answer(0, refused());
    expect([tab.step(), tab.error(), tab.busy()]).toEqual([1, 0, false]);
    expect(mocks.error).not.toHaveBeenCalled();
  });

  it('a status error hiding the wizard retires the check: back from Retry, step 1, idle, no account', async () => {
    const tab = page();
    await tab.open('site-a');
    await tab.type(TOKEN_A);
    await tab.press();
    // A 4xx is not retried, so the read fails at once and the error screen replaces the wizard.
    mocks.statusGet.mockImplementationOnce(async () => json(403, { error: { code: 'FORBIDDEN', message: 'No access.' } }));
    await act(async () => void client.refetchQueries({ queryKey: detail('site-a') }));
    await settle();
    expect(tab.step()).toBeNull();
    expect(tab.host.textContent).toContain(t('settings.git.workflow.loadError'));
    await answer(0, verified);
    await act(async () => tab.button('common.retry')?.click());
    await settle();
    expect(tab.step()).toBe(1);
    expect(tab.busy()).toBe(false);
    expect(tab.error()).toBe(0);
    expect(tab.input()?.value).toBe(TOKEN_A);
  });

  it('a status error hiding the wizard keeps a late refusal out of the wizard that comes back', async () => {
    const tab = page();
    await tab.open('site-a');
    await tab.type(TOKEN_A);
    await tab.press();
    mocks.statusGet.mockImplementationOnce(async () => json(403, { error: { code: 'FORBIDDEN', message: 'No access.' } }));
    await act(async () => void client.refetchQueries({ queryKey: detail('site-a') }));
    await settle();
    await answer(0, refused());
    await act(async () => tab.button('common.retry')?.click());
    await settle();
    expect([tab.step(), tab.error(), tab.busy()]).toEqual([1, 0, false]);
  });

  it('a connected status arriving first retires the check; a later disconnect shows step 1 without the account', async () => {
    const tab = page();
    await tab.open('site-a');
    await tab.type(TOKEN_A);
    await tab.press();
    connected['site-a'] = true;
    await act(async () => void client.refetchQueries({ queryKey: detail('site-a') }));
    await settle();
    expect(tab.step()).toBeNull();
    await answer(0, verified);
    connected['site-a'] = false;
    await act(async () => void client.refetchQueries({ queryKey: detail('site-a') }));
    await settle();
    expect([tab.step(), tab.busy(), tab.error()]).toEqual([1, false, 0]);
  });

  it('programmatic: a status reset to its first load (skeleton) retires the check', async () => {
    const tab = page();
    await tab.open('site-a');
    await tab.type(TOKEN_A);
    await tab.press();
    let answerRead: (response: Response) => void = () => undefined;
    mocks.statusGet.mockImplementationOnce(
      () =>
        new Promise<Response>((resolve) => {
          answerRead = resolve;
        }),
    );
    await act(async () => void client.resetQueries({ queryKey: detail('site-a') }));
    await settle();
    expect(tab.host.querySelector('[data-slot="git-workflow-skeleton"]')).not.toBeNull();
    await answer(0, verified);
    await act(async () => answerRead(json(200, { data: null })));
    await settle();
    expect([tab.step(), tab.busy()]).toEqual([1, false]);
  });

  it('a session change drops the old check’s refresh and report, and the remounted wizard is usable', async () => {
    const tab = page();
    await tab.open('site-a');
    await tab.type(TOKEN_A);
    await tab.press();
    await act(async () => resetDashboardSession(client));
    // AppGuard remounts the dashboard for the new session.
    await tab.open('site-a', 'git-site-a-next-session');
    await answer(0, verified);
    expect(refreshed()).toEqual([]);
    expect([tab.step(), tab.busy(), tab.input()?.value]).toEqual([1, false, '']);
    await tab.type(TOKEN_B);
    await tab.press();
    await answer(1, verified);
    expect(tab.step()).toBe(2);
    expect(refreshed()).toEqual([detail('site-a')]);
  });

  it('programmatic: one instance moved from site A to B ignores A’s answer, refreshes A only, and is idle for B', async () => {
    const tab = page();
    await tab.open('site-a', null);
    await tab.type(TOKEN_A);
    await tab.press();
    await tab.open('site-b', null);
    expect(tab.busy()).toBe(false);
    await answer(0, verified);
    expect(refreshed()).toEqual([detail('site-a')]);
    expect(tab.step()).toBe(1);
    await tab.press();
    expect(posts().map((request) => request.param.projectId)).toEqual(['site-a', 'site-b']);
  });
});

/** Errors as their fields (JSON.stringify drops them otherwise); functions and cycles left out. */
const asText = (value: unknown) => {
  const seen = new WeakSet<object>();
  return JSON.stringify(value, (_key, item: unknown) => {
    if (typeof item === 'function') return;
    if (item instanceof Error) return { ...item, name: item.name, message: item.message, cause: item.cause };
    if (item && typeof item === 'object') {
      if (seen.has(item)) return;
      seen.add(item);
    }
    return item;
  });
};
/**
 * Everything the QueryClient holds or would hand on: every mutation (options, variables, error), every query (key,
 * data, error), an all-mutation and all-query dehydration, and the default dehydration.
 */
const clientText = () =>
  asText({
    mutations: client
      .getMutationCache()
      .getAll()
      .map((mutation) => ({ key: mutation.options.mutationKey, meta: mutation.options.meta, state: mutation.state })),
    queries: client
      .getQueryCache()
      .getAll()
      .map((query) => ({ key: query.queryKey, meta: query.meta, state: query.state })),
    everything: dehydrate(client, { shouldDehydrateMutation: () => true, shouldDehydrateQuery: () => true }),
    byDefault: dehydrate(client),
  });
/** No placeholder token anywhere the QueryClient keeps or hands on, and no authorization mutation at all. */
const expectNoTokenCached = () => {
  const text = clientText();
  for (const token of [TOKEN_A, TOKEN_B]) expect(text).not.toContain(token);
  expect(text).not.toContain('test-token');
  expect(client.getMutationCache().getAll()).toEqual([]);
};
/** A refusal whose message echoes the token it was sent. */
const echoed = (request: AuthorizeRequest) =>
  json(400, { error: { code: 'BAD_REQUEST', message: `Bad credentials: ${request.json.token}`, details: { token: request.json.token } } });

describe('the token is never kept by the QueryClient', () => {
  it('neither while a check runs nor after it succeeds', async () => {
    const tab = page();
    await tab.open('site-a');
    await tab.type(TOKEN_A);
    await tab.press();
    expect(posts()).toHaveLength(1);
    expectNoTokenCached();
    await answer(0, verified);
    expect(tab.step()).toBe(2);
    expectNoTokenCached();
  });

  it('nor after a refusal that echoes it, which shows only the existing error, and after the token is corrected', async () => {
    const tab = page();
    await tab.open('site-a');
    await tab.type(TOKEN_A);
    await tab.press();
    await answer(0, echoed);
    expect(tab.error()).toBe(1);
    expect(tab.host.textContent).not.toContain(TOKEN_A);
    expectNoTokenCached();
    await tab.type(TOKEN_B);
    expect(tab.error()).toBe(0);
    expectNoTokenCached();
  });

  it('nor after a retired check settles, an unmount, or a session reset', async () => {
    const tab = page();
    await tab.open('site-a');
    await tab.type(TOKEN_A);
    await tab.press();
    await tab.type(TOKEN_B);
    await answer(0, echoed);
    expectNoTokenCached();
    await tab.press();
    await tab.open('site-b');
    expectNoTokenCached();
    await answer(1, verified);
    expectNoTokenCached();
    await tab.open('site-a');
    await tab.type(TOKEN_A);
    await tab.press();
    await act(async () => resetDashboardSession(client));
    await tab.open('site-a', 'git-site-a-next-session');
    expectNoTokenCached();
    await answer(2, verified);
    expectNoTokenCached();
  });

  it('nor while offline: nothing is paused for later, and the default dehydration is clear', async () => {
    const tab = page();
    await tab.open('site-a');
    await tab.type(TOKEN_A);
    onlineManager.setOnline(false);
    try {
      await tab.press();
      expectNoTokenCached();
      // Sent now, not paused and replayed on reconnect; a dropped request is reported inline.
      expect(posts()).toHaveLength(1);
      const entry = held[0];
      if (!entry) throw new Error('no request');
      await act(async () => entry.reject(new TypeError('Failed to fetch')));
      await settle();
      expect(tab.error()).toBe(1);
      expectNoTokenCached();
    } finally {
      onlineManager.setOnline(true);
    }
  });
});

describe('the commit that hides the wizard retires its check', () => {
  // Outside act, as in the browser: a hiding render's passive effects run in a later task, so an answer that settles
  // right after the commit (here, answered from a layout effect of that very commit) runs before them.
  it('an answer settling right after the wizard hides neither moves it on nor reports', async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', false);
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    const verifiedWith: unknown[] = [];
    let command: ReturnType<typeof useGitAuthorizationCommand> | undefined;
    let outcome: 'verified' | 'refused' = 'verified';
    /** Answers the held request in the layout phase of the commit that hides the wizard. */
    function AnswerOnHide({ shown }: { shown: boolean }) {
      useLayoutEffect(() => {
        if (shown) return;
        const response = {
          ok: outcome === 'verified',
          status: outcome === 'verified' ? 200 : 400,
          headers: new Headers(),
          json: async () => (outcome === 'verified' ? { data: ACCOUNT_A } : { error: { code: 'BAD_REQUEST', message: 'Refused.' } }),
          text: async () => JSON.stringify({ error: { code: 'BAD_REQUEST', message: 'Refused.' } }),
          clone() {
            return this;
          },
        };
        held.at(-1)?.resolve(response as unknown as Response);
      }, [shown]);
      return null;
    }
    function Wizard({ shown }: { shown: boolean }) {
      command = useGitAuthorizationCommand({ projectId: 'site-a', shown });
      return <AnswerOnHide shown={shown} />;
    }
    const nextTasks = async () => {
      for (let task = 0; task < 10; task += 1) await new Promise((done) => setTimeout(done, 5));
    };
    const show = (shown: boolean) =>
      root.render(
        <QueryClientProvider client={client}>
          <Wizard shown={shown} />
        </QueryClientProvider>,
      );
    try {
      for (const result of ['verified', 'refused'] as const) {
        outcome = result;
        show(true);
        await nextTasks();
        command?.verify(TOKEN_A, (identity) => verifiedWith.push(identity));
        await nextTasks();
        expect(command?.busy).toBe(true);
        show(false);
        await nextTasks();
        expect(verifiedWith).toEqual([]);
        expect([command?.busy, command?.failed]).toEqual([false, false]);
      }
      expect(posts()).toHaveLength(2);
    } finally {
      root.unmount();
      host.remove();
      vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    }
  });
});
