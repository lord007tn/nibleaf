// @vitest-environment jsdom
// Sync and Update PR in GitWorkflow. Real QueryClient (the app's own), the real status query, mutation and
// component; only the HTTP calls are replaced, and held until the test answers them. No provider is reached.
//
// Which cases ordinary use reaches: a double press, switching panel while a request runs (and coming back),
// leaving for another site (the settings page keys the Git tab by site, so that is an unmount) and returning,
// a locale change, and two instances of the same site. A site change on the *same* instance is not reachable
// through the settings page; those tests are marked "programmatic".
import type { MessageKey } from '@nibleaf/i18n';
import { translateFn } from '@nibleaf/i18n';
import { QueryClientProvider } from '@tanstack/react-query';
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  locale: 'en' as 'en' | 'ar',
  status: vi.fn(),
  operations: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
}));
vi.mock('sonner', () => ({ toast: { error: mocks.error, success: mocks.success } }));
vi.mock('@nibleaf/design-system/components/ui/confirm', () => ({ useConfirm: () => vi.fn() }));
vi.mock('@/env', () => ({ env: { VITE_APP_URL: 'https://app.example.test' } }));
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
vi.mock('@/services/api', () => ({
  api: { app: { projects: { ':projectId': { git: { $get: mocks.status, operations: { $post: mocks.operations } } } } } },
}));

import { queryKeys } from '@/hooks/api/query-keys';
import { createQueryClient } from '@/integrations/tanstack-query/query-client';
import { GitWorkflow } from './git-workflow';

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);

const t = (key: MessageKey) => translateFn(key, undefined, mocks.locale);
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const conflict = { id: 'conflict-1', path: 'docs/intro.mdx', status: 'OPEN', baseContent: 'a', oursContent: 'b', theirsContent: 'c' };
const status = (projectId: string, conflicts: (typeof conflict)[] = []) => ({
  id: `connection-${projectId}`,
  repository: `acme-fixture/${projectId}`,
  baseBranch: `main-${projectId}`,
  headBranch: 'nibleaf/docs',
  contentPath: 'docs',
  credentialConfigured: true,
  webhookConfigured: true,
  lastSyncStatus: 'SUCCEEDED',
  lastSyncError: null,
  lastSyncedAt: '2026-11-15T09:00:00.000Z',
  operations: conflicts.length
    ? [
        {
          id: 'op-0',
          kind: 'PULL',
          status: 'CONFLICT',
          commitMessage: null,
          changedFiles: null,
          pullRequestNo: null,
          pullRequestUrl: null,
          error: null,
          createdAt: '2026-11-15T09:00:00.000Z',
          conflicts,
        },
      ]
    : [],
  pullRequests: [],
  files: [],
});
const queued = (kind: string) => json(200, { data: { id: 'op-new', kind, status: 'QUEUED', conflicts: [] } });
// A refusal the test invents (a 409 without a known code), which the friendly mapping turns into its conflict message.
const failure = () => json(409, { error: { message: 'Refused by the test.' } });
const FAILED = () => t('error.conflict');
/** Lets mutations settle: TanStack tells React on a timer, so each tick gets its own act. */
const settle = async () => {
  for (let tick = 0; tick < 4; tick += 1) await act(async () => new Promise((done) => setTimeout(done, 0)));
};
function held() {
  let resolve: (value: Response) => void = () => undefined;
  const promise = new Promise<Response>((done) => {
    resolve = done;
  });
  return {
    promise,
    answer: async (response: Response) => {
      await act(async () => resolve(response));
      await settle();
    },
  };
}

let container: HTMLDivElement;
let root: Root;
let client: ReturnType<typeof createQueryClient>;
let refreshed: () => unknown[];
let conflicts: Record<string, (typeof conflict)[]>;

const render = async (node: ReactNode) => {
  await act(async () => root.render(<QueryClientProvider client={client}>{node}</QueryClientProvider>));
  await settle();
};
const workflow = (projectId: string, key?: string) => render(<GitWorkflow key={key} projectId={projectId} />);

const buttons = (scope: ParentNode = container) => [...scope.querySelectorAll('button')];
const button = (label: string, scope?: ParentNode) => buttons(scope).find((item) => item.textContent?.trim() === label);
const panel = (label: MessageKey) => press(buttons().find((item) => item.hasAttribute('aria-pressed') && item.textContent?.startsWith(t(label))));
const press = async (element: HTMLElement | undefined) => {
  if (!element) throw new Error('nothing to press');
  await act(async () => element.click());
  await settle();
};
/** Two presses in one task, before React renders in between. */
const pressTwice = async (element: HTMLElement | undefined) => {
  if (!element) throw new Error('nothing to press');
  await act(async () => {
    element.click();
    element.click();
  });
  await settle();
};
const syncButton = (scope?: ParentNode) => button(t('settings.git.workflow.syncLatest'), scope);
const updatePrButton = (scope?: ParentNode) => button(t('settings.git.workflow.updatePr'), scope);
const field = (id: string) => {
  const input = container.querySelector<HTMLInputElement>(`#${id}`);
  if (!input) throw new Error(`no #${id}`);
  return input;
};
const type = async (id: string, value: string) => {
  const input = field(id);
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
};
const isBusy = (element: HTMLElement | undefined) => element?.getAttribute('aria-busy') === 'true';
const posts = () => mocks.operations.mock.calls.map(([request]) => request);
const reads = (projectId: string) => mocks.status.mock.calls.filter(([request]) => request.param.projectId === projectId).length;
const errors = () => mocks.error.mock.calls.map(([message]) => message);

beforeEach(() => {
  mocks.locale = 'en';
  conflicts = {};
  client = createQueryClient();
  const invalidate = vi.spyOn(client, 'invalidateQueries');
  refreshed = () => invalidate.mock.calls.map(([filters]) => filters?.queryKey);
  mocks.status.mockReset().mockImplementation(async ({ param }) => json(200, { data: status(param.projectId, conflicts[param.projectId]) }));
  mocks.operations.mockReset().mockImplementation(async ({ json: body }) => queued(body.kind));
  mocks.success.mockReset();
  mocks.error.mockReset();
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

describe('Sync and Update PR own their request', () => {
  it("Sync sends main's PULL body for the site, refreshes that site's status, and is busy through the refresh", async () => {
    await workflow('site-a');
    await panel('settings.git.workflow.nav.sync');
    const post = held();
    mocks.operations.mockImplementationOnce(() => post.promise);
    await press(syncButton());
    expect(posts()).toEqual([
      { param: { projectId: 'site-a' }, json: { idempotencyKey: expect.stringMatching(UUID), kind: 'PULL', sourceRef: 'main-site-a' } },
    ]);
    expect(isBusy(syncButton())).toBe(true);

    // The refresh after it: still busy until that read answers.
    const read = held();
    mocks.status.mockImplementationOnce(() => read.promise);
    await post.answer(queued('PULL'));
    expect(refreshed()).toEqual([queryKeys.gitWorkflow.detail('site-a')]);
    expect(isBusy(syncButton())).toBe(true);
    await read.answer(json(200, { data: status('site-a') }));
    expect(isBusy(syncButton())).toBe(false);
    expect(reads('site-a')).toBe(2);
    expect(mocks.success).not.toHaveBeenCalled();
    expect(errors()).toEqual([]);
  });

  it('Update PR sends every field raw as typed, with createPullRequest, and keeps edits typed while it runs', async () => {
    await workflow('site-a');
    await panel('settings.git.workflow.nav.publish');
    await type('git2-message', '  Refresh the guides  ');
    await type('git2-author', ' Ada Example ');
    await type('git2-email', 'ada@example.test');
    await type('git2-title', '  Guides refresh ');
    const post = held();
    mocks.operations.mockImplementationOnce(() => post.promise);
    await press(updatePrButton());
    expect(posts()).toEqual([
      {
        param: { projectId: 'site-a' },
        json: {
          idempotencyKey: expect.stringMatching(UUID),
          kind: 'PUSH',
          commitMessage: '  Refresh the guides  ',
          authorName: ' Ada Example ',
          authorEmail: 'ada@example.test',
          createPullRequest: true,
          pullRequestTitle: '  Guides refresh ',
        },
      },
    ]);
    expect(Object.keys(posts()[0].json)).toEqual([
      'idempotencyKey',
      'kind',
      'commitMessage',
      'authorName',
      'authorEmail',
      'createPullRequest',
      'pullRequestTitle',
    ]);
    await type('git2-message', 'Typed while it runs');
    await post.answer(queued('PUSH'));
    expect(field('git2-message').value).toBe('Typed while it runs');
    expect(field('git2-title').value).toBe('  Guides refresh ');
    expect(refreshed()).toEqual([queryKeys.gitWorkflow.detail('site-a')]);
    expect(mocks.success).not.toHaveBeenCalled();
  });

  it.each([
    ['Sync', 'settings.git.workflow.nav.sync', syncButton],
    ['Update PR', 'settings.git.workflow.nav.publish', updatePrButton],
  ] as const)('%s pressed twice in one task sends once, with one key', async (_name, nav, target) => {
    await workflow('site-a');
    await panel(nav);
    const post = held();
    mocks.operations.mockImplementationOnce(() => post.promise);
    await pressTwice(target());
    expect(posts()).toHaveLength(1);
    await press(target());
    expect(posts()).toHaveLength(1);
    await post.answer(queued('PULL'));
    expect(refreshed()).toEqual([queryKeys.gitWorkflow.detail('site-a')]);
  });

  it('a running Sync keeps Update PR busy for the site, as the one shared operation did', async () => {
    await workflow('site-a');
    await panel('settings.git.workflow.nav.sync');
    const post = held();
    mocks.operations.mockImplementationOnce(() => post.promise);
    await press(syncButton());
    await panel('settings.git.workflow.nav.publish');
    expect(isBusy(updatePrButton())).toBe(true);
    await press(updatePrButton());
    expect(posts()).toHaveLength(1);
    await post.answer(queued('PULL'));
    expect(isBusy(updatePrButton())).toBe(false);
  });

  it('a failure is reported once in its panel; a retry sends the same body under a new key', async () => {
    await workflow('site-a');
    await panel('settings.git.workflow.nav.sync');
    const post = held();
    mocks.operations.mockImplementationOnce(() => post.promise);
    await press(syncButton());
    await post.answer(failure());
    expect(errors()).toEqual([FAILED()]);
    expect(refreshed()).toEqual([]);
    expect(isBusy(syncButton())).toBe(false);

    await press(syncButton());
    expect(posts()).toHaveLength(2);
    const [first, second] = posts();
    expect(second.json).toEqual({ ...first.json, idempotencyKey: expect.stringMatching(UUID) });
    expect(second.json.idempotencyKey).not.toBe(first.json.idempotencyKey);
    expect(errors()).toHaveLength(1);
    expect(refreshed()).toEqual([queryKeys.gitWorkflow.detail('site-a')]);
  });

  it.each([
    ['another panel', async () => panel('settings.git.workflow.nav.overview')],
    [
      'Sync → Update PR → Sync',
      async () => {
        await panel('settings.git.workflow.nav.publish');
        await panel('settings.git.workflow.nav.sync');
      },
    ],
    ['leaving the site (unmount)', async () => render(null)],
  ] as const)('a failure that lands after %s is not reported anywhere', async (_case, leave) => {
    await workflow('site-a');
    await panel('settings.git.workflow.nav.sync');
    const post = held();
    mocks.operations.mockImplementationOnce(() => post.promise);
    await press(syncButton());
    await leave();
    await post.answer(failure());
    expect(errors()).toEqual([]);
    expect(refreshed()).toEqual([]);
  });

  it('a success that lands after leaving the site still refreshes that site', async () => {
    await workflow('site-a', 'git-site-a');
    await panel('settings.git.workflow.nav.sync');
    const post = held();
    mocks.operations.mockImplementationOnce(() => post.promise);
    await press(syncButton());
    await workflow('site-b', 'git-site-b');
    await post.answer(queued('PULL'));
    expect(refreshed()).toEqual([queryKeys.gitWorkflow.detail('site-a')]);
    expect(errors()).toEqual([]);
  });

  it('a locale change on the same site keeps the panel: its failure is still reported once', async () => {
    await workflow('site-a');
    await panel('settings.git.workflow.nav.sync');
    const post = held();
    mocks.operations.mockImplementationOnce(() => post.promise);
    await press(syncButton());
    const english = FAILED();
    mocks.locale = 'ar';
    await workflow('site-a');
    expect(container.textContent).toContain(t('settings.git.workflow.syncTitle'));
    expect(isBusy(syncButton())).toBe(true);
    await post.answer(failure());
    // The message is the press's, as main's mutate callback was.
    expect(errors()).toEqual([english]);
  });

  it('keyed A → B → A while A runs: A is still busy and refuses a second send; B is independent', async () => {
    await workflow('site-a', 'git-site-a');
    await panel('settings.git.workflow.nav.sync');
    const postA = held();
    mocks.operations.mockImplementationOnce(() => postA.promise);
    await press(syncButton());

    await workflow('site-b', 'git-site-b');
    await panel('settings.git.workflow.nav.sync');
    expect(isBusy(syncButton())).toBe(false);
    const postB = held();
    mocks.operations.mockImplementationOnce(() => postB.promise);
    await press(syncButton());
    expect(posts().map((request) => request.param.projectId)).toEqual(['site-a', 'site-b']);

    await workflow('site-a', 'git-site-a');
    await panel('settings.git.workflow.nav.sync');
    expect(isBusy(syncButton())).toBe(true);
    await press(syncButton());
    expect(posts()).toHaveLength(2);

    await postB.answer(queued('PULL'));
    expect(refreshed()).toEqual([queryKeys.gitWorkflow.detail('site-b')]);
    expect(isBusy(syncButton())).toBe(true);
    await postA.answer(failure());
    // A's failure started in a panel that unmounted: the remounted A panel is a new one.
    expect(errors()).toEqual([]);
    expect(isBusy(syncButton())).toBe(false);
    await press(syncButton());
    expect(posts()).toHaveLength(3);
  });

  it('two instances of one site: a press in one makes the other busy and refuses its press in the same task', async () => {
    await render(
      <>
        <section data-instance="one">
          <GitWorkflow projectId="site-a" />
        </section>
        <section data-instance="two">
          <GitWorkflow projectId="site-a" />
        </section>
      </>,
    );
    const instance = (name: string) => container.querySelector<HTMLElement>(`[data-instance="${name}"]`) ?? container;
    const [one, two] = [instance('one'), instance('two')];
    const syncNav = `${t('settings.git.workflow.nav.sync')}${t('settings.git.workflow.nav.syncDesc')}`;
    await press(button(syncNav, one));
    await press(button(syncNav, two));
    const post = held();
    mocks.operations.mockImplementationOnce(() => post.promise);
    await act(async () => {
      syncButton(one)?.click();
      syncButton(two)?.click();
    });
    await settle();
    expect(posts()).toHaveLength(1);
    expect(isBusy(syncButton(two))).toBe(true);
    await post.answer(queued('PULL'));
    expect(isBusy(syncButton(one))).toBe(false);
    expect(isBusy(syncButton(two))).toBe(false);
  });

  it('programmatic same-instance A → B: A still refreshes only A, and B is not busy because of it', async () => {
    await workflow('site-a');
    await panel('settings.git.workflow.nav.sync');
    const post = held();
    mocks.operations.mockImplementationOnce(() => post.promise);
    await press(syncButton());
    await workflow('site-b');
    await panel('settings.git.workflow.nav.sync');
    expect(isBusy(syncButton())).toBe(false);
    await post.answer(queued('PULL'));
    expect(refreshed()).toEqual([queryKeys.gitWorkflow.detail('site-a')]);
    await press(syncButton());
    expect(posts().map((request) => [request.param.projectId, request.json.sourceRef])).toEqual([
      ['site-a', 'main-site-a'],
      ['site-b', 'main-site-b'],
    ]);
  });

  it('an open conflict still blocks Sync, and Update PR is not gated by it', async () => {
    conflicts['site-a'] = [conflict];
    await workflow('site-a');
    await panel('settings.git.workflow.nav.sync');
    expect(syncButton()?.disabled).toBe(true);
    expect(container.textContent).toContain(t('settings.git.workflow.resolveFirst'));
    await press(syncButton());
    expect(posts()).toEqual([]);
    await panel('settings.git.workflow.nav.publish');
    expect(updatePrButton()?.disabled).toBe(false);
    await press(updatePrButton());
    expect(posts().map((request) => request.json.kind)).toEqual(['PUSH']);
  });
});
