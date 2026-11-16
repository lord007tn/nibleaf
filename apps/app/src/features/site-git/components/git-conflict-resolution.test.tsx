// @vitest-environment jsdom
// Settings → Git → two-way sync → Reconcile conflicts. The real GitWorkflow, conflict card, query hook and resolution
// mutation with the app's own QueryClient and ConfirmProvider; only the HTTP calls are replaced (every API call is
// answered here) and a resolution POST can be held until the test answers it. Sites, conflicts and contents are
// fictional.
//
// Which cases ordinary use reaches: presses in the same tick or later, a language change, a refetch (Refresh or the
// readback), leaving for another site and coming back (the settings page keys the Git tab by site, so that is an
// unmount and a new instance), a conflict leaving the list, two conflicts, two sites' tabs at once, and a session
// change (AppGuard remounts the dashboard). Two mounted copies of one site's panel, and one card instance moved to
// another site or conflict, are not reachable through the settings page; those tests are marked "programmatic".
import { ConfirmProvider } from '@nibleaf/design-system/components/ui/confirm';
import { translateFn } from '@nibleaf/i18n';
import { gitConflictResolutionBody } from '@nibleaf/validators';
import { QueryClientProvider } from '@tanstack/react-query';
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  locale: 'en' as 'en' | 'ar',
  resolvePost: vi.fn(),
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
// Every API call: the status read goes to `mocks.statusGet`, a resolution to `mocks.resolvePost`.
vi.mock('@/services/api', () => {
  const answer = (path: string, request: { param?: { projectId?: string } } | undefined) => {
    if (path === 'git.$get') return mocks.statusGet(request?.param?.projectId);
    if (path === 'git.conflicts.:conflictId.resolve.$post') return mocks.resolvePost(request);
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
import { gitWorkflowQueryOptions } from '@/hooks/api/query-options';
import { createQueryClient } from '@/integrations/tanstack-query/query-client';
import { resetDashboardSession } from '@/integrations/tanstack-query/session-cache';
import { GitConflictCard } from './git-conflict-card';

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);

const t = (key: Parameters<typeof translateFn>[0]) => translateFn(key, undefined, mocks.locale);
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const ERROR = () => t('settings.git.workflow.conflict.error');
/** Synthetic conflict ids. */
const C1 = '00000000-0000-4000-8000-000000000001';
const C2 = '00000000-0000-4000-8000-000000000002';
const C3 = '00000000-0000-4000-8000-000000000003';

type Conflict = { id: string; path: string; status: string; baseContent: string | null; oursContent: string | null; theirsContent: string | null };
const conflict = (id: string, path: string, oursContent: string | null = `ours of ${path}`): Conflict => ({
  id,
  path,
  status: 'OPEN',
  baseContent: `base of ${path}`,
  oursContent,
  theirsContent: `theirs of ${path}`,
});
/** The open conflicts each site's status shows; a success marks the conflict resolved for the next read. */
let open: Record<string, Conflict[]>;
const status = (projectId: string) => ({
  id: `connection-${projectId}`,
  repository: `acme-fixture/${projectId}`,
  baseBranch: 'main',
  headBranch: 'nibleaf/docs',
  contentPath: 'docs',
  credentialConfigured: true,
  webhookConfigured: true,
  lastSyncStatus: 'CONFLICT',
  lastSyncError: null,
  lastSyncedAt: '2026-11-15T09:00:00.000Z',
  operations: [
    {
      id: `operation-${projectId}`,
      kind: 'PULL',
      status: 'CONFLICT',
      commitMessage: null,
      changedFiles: null,
      pullRequestNo: null,
      pullRequestUrl: null,
      error: null,
      createdAt: '2026-11-15T09:00:00.000Z',
      conflicts: open[projectId] ?? [],
    },
  ],
  pullRequests: [],
  files: [],
});
type ResolveRequest = { param: { projectId: string; conflictId: string }; json: Record<string, unknown> };
const resolved = (request: ResolveRequest) => {
  const { projectId, conflictId } = request.param;
  open[projectId] = (open[projectId] ?? []).filter((item) => item.id !== conflictId);
  return json(200, { data: { id: conflictId, status: 'RESOLVED', resolution: request.json.resolution } });
};

/** Lets mutations and queries settle: TanStack tells React on a timer, so each tick gets its own act. */
const settle = async () => {
  for (let tick = 0; tick < 4; tick += 1) await act(async () => new Promise((done) => setTimeout(done, 0)));
};
function held<T = Response>() {
  let resolve: (value: T) => void = () => undefined;
  let reject: (error: unknown) => void = () => undefined;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return {
    promise,
    answer: async (value: T) => {
      await act(async () => resolve(value));
      await settle();
    },
    drop: async (error: unknown) => {
      await act(async () => reject(error));
      await settle();
    },
  };
}

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
  const card = (path: string) => [...host.querySelectorAll('section')].find((section) => section.querySelector('code')?.textContent === path);
  const button = (path: string, label: Parameters<typeof translateFn>[0]) =>
    [...(card(path)?.querySelectorAll<HTMLButtonElement>('button') ?? [])].find((item) => item.textContent?.includes(t(label)));
  const textarea = (path: string) => card(path)?.querySelector('textarea') ?? null;
  return {
    host,
    /** The site's panel, keyed by site unless `key` is null (one instance moved: programmatic). */
    open: (projectId: string, key: string | null = `git-${projectId}`) => render(<GitWorkflow key={key ?? undefined} projectId={projectId} />),
    card,
    button,
    textarea,
    press: async (path: string, label: Parameters<typeof translateFn>[0]) => {
      await act(async () => button(path, label)?.click());
      await settle();
    },
    /** Types into the custom resolution as a person would (React's value tracker sees the change). */
    type: async (path: string, value: string) => {
      const area = textarea(path);
      if (!area) throw new Error(`no custom text for ${path}`);
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
      await act(async () => {
        setter?.call(area, value);
        area.dispatchEvent(new Event('input', { bubbles: true }));
      });
    },
    /** All four buttons busy (they share one busy state). */
    isBusy: (path: string) => {
      const states = (['useNibleaf', 'useGit', 'useCustom', 'delete'] as const).map(
        (label) => button(path, `settings.git.workflow.conflict.${label}`)?.getAttribute('aria-busy') === 'true',
      );
      expect(new Set(states).size).toBe(1);
      return states[0];
    },
  };
}
const OURS = 'settings.git.workflow.conflict.useNibleaf' as const;
const THEIRS = 'settings.git.workflow.conflict.useGit' as const;
const CUSTOM = 'settings.git.workflow.conflict.useCustom' as const;
const DELETE = 'settings.git.workflow.conflict.delete' as const;
const posts = () => mocks.resolvePost.mock.calls.map(([request]) => request as ResolveRequest);
const detail = (projectId: string) => queryKeys.gitWorkflow.detail(projectId);

beforeEach(() => {
  mocks.locale = 'en';
  open = { 'site-a': [conflict(C1, 'docs/intro.md'), conflict(C2, 'docs/setup.md')], 'site-b': [conflict(C3, 'docs/guide.md')] };
  client = createQueryClient();
  const invalidate = vi.spyOn(client, 'invalidateQueries');
  refreshed = () => invalidate.mock.calls.map(([filters]) => filters?.queryKey);
  mocks.statusGet.mockReset().mockImplementation(async (projectId: string) => json(200, { data: status(projectId) }));
  mocks.resolvePost.mockReset().mockImplementation(async (request: ResolveRequest) => resolved(request));
  mocks.error.mockReset();
  mocks.success.mockReset();
});
afterEach(async () => {
  for (const { host, root } of hosts.splice(0)) {
    await act(async () => root.unmount());
    host.remove();
  }
});

describe('a conflict resolution sends exactly what the person chose', () => {
  it.each([
    ['Use Nibleaf', OURS, undefined, { resolution: 'OURS' }],
    ['Use Git', THEIRS, undefined, { resolution: 'THEIRS' }],
    ['Use custom, as it starts (the Nibleaf version)', CUSTOM, undefined, { resolution: 'CUSTOM', content: 'ours of docs/intro.md' }],
    ['Use custom, emptied', CUSTOM, '', { resolution: 'CUSTOM', content: '' }],
    [
      'Use custom, whitespace and newlines kept',
      CUSTOM,
      '  # Intro\n\n<b>&amp;</b>\t\n',
      { resolution: 'CUSTOM', content: '  # Intro\n\n<b>&amp;</b>\t\n' },
    ],
    ['Use custom, Arabic', CUSTOM, 'مرحبًا بالعالم\nالسطر الثاني', { resolution: 'CUSTOM', content: 'مرحبًا بالعالم\nالسطر الثاني' }],
    ['Delete file (null, not empty)', DELETE, 'typed but not sent', { resolution: 'CUSTOM', content: null }],
  ] as const)('%s', async (_name, label, typed, body) => {
    const tab = page();
    await tab.open('site-a');
    if (typed !== undefined) await tab.type('docs/intro.md', typed);
    await tab.press('docs/intro.md', label);
    expect(posts()).toEqual([{ param: { projectId: 'site-a', conflictId: C1 }, json: body }]);
    // The server's own validator accepts it unchanged (content absent, a string, or null).
    expect(gitConflictResolutionBody.parse(posts()[0]?.json)).toEqual(body);
    expect(Object.hasOwn(posts()[0]?.json ?? {}, 'content')).toBe(label === CUSTOM || label === DELETE);
    // Only the site's status is refreshed; the readback shows the conflict resolved, so its card leaves.
    expect(refreshed()).toEqual([detail('site-a')]);
    expect(tab.card('docs/intro.md')).toBeUndefined();
    expect(tab.card('docs/setup.md')).toBeDefined();
    expect(mocks.error).not.toHaveBeenCalled();
    expect(mocks.success).not.toHaveBeenCalled();
  });

  it('shows null sides as a deleted file, and an empty side as empty', async () => {
    open['site-a'] = [{ ...conflict(C1, 'docs/intro.md', ''), baseContent: null, theirsContent: '<script>x</script>' }];
    const tab = page();
    await tab.open('site-a');
    const sides = [...(tab.card('docs/intro.md')?.querySelectorAll('pre') ?? [])].map((pre) => pre.textContent);
    expect(sides).toEqual([t('settings.git.workflow.conflict.deleted'), '', '<script>x</script>']);
    expect(tab.card('docs/intro.md')?.querySelector('script')).toBeNull();
    expect(tab.textarea('docs/intro.md')?.value).toBe('');
    expect(tab.textarea('docs/intro.md')?.id).toBe(`custom-${C1}`);
  });
});

describe('one resolution at a time per site and conflict', () => {
  it('sends once for all four buttons pressed in the same tick, all busy until the readback', async () => {
    const tab = page();
    await tab.open('site-a');
    const answer = held();
    mocks.resolvePost.mockImplementation(() => answer.promise);
    await act(async () => {
      for (const label of [OURS, THEIRS, CUSTOM, DELETE]) tab.button('docs/intro.md', label)?.click();
    });
    await settle();
    expect(posts()).toEqual([{ param: { projectId: 'site-a', conflictId: C1 }, json: { resolution: 'OURS' } }]);
    expect(tab.isBusy('docs/intro.md')).toBe(true);
    await tab.press('docs/intro.md', THEIRS);
    expect(posts()).toHaveLength(1);
    // The success's refetch is held too: still busy until the status answers.
    const readback = held();
    mocks.statusGet.mockImplementationOnce(() => readback.promise);
    await answer.answer(resolved(posts()[0] as ResolveRequest));
    expect(tab.isBusy('docs/intro.md')).toBe(true);
    await tab.press('docs/intro.md', CUSTOM);
    expect(posts()).toHaveLength(1);
    await readback.answer(json(200, { data: status('site-a') }));
    expect(tab.card('docs/intro.md')).toBeUndefined();
    expect(refreshed()).toEqual([detail('site-a')]);
  });

  it('programmatic: two copies of the same panel send one resolution between them; the other copy shows it busy', async () => {
    const first = page();
    const second = page();
    await first.open('site-a');
    await second.open('site-a');
    const answer = held();
    mocks.resolvePost.mockImplementation(() => answer.promise);
    await act(async () => {
      first.button('docs/intro.md', OURS)?.click();
      second.button('docs/intro.md', THEIRS)?.click();
    });
    await settle();
    expect(posts()).toEqual([{ param: { projectId: 'site-a', conflictId: C1 }, json: { resolution: 'OURS' } }]);
    expect(first.isBusy('docs/intro.md')).toBe(true);
    expect(second.isBusy('docs/intro.md')).toBe(true);
    await answer.answer(resolved(posts()[0] as ResolveRequest));
    expect(first.card('docs/intro.md')).toBeUndefined();
    expect(second.card('docs/intro.md')).toBeUndefined();
  });

  it('keeps another conflict of the site usable while one waits', async () => {
    const tab = page();
    await tab.open('site-a');
    const answer = held();
    mocks.resolvePost.mockImplementationOnce(() => answer.promise);
    await tab.press('docs/intro.md', OURS);
    expect(tab.isBusy('docs/intro.md')).toBe(true);
    expect(tab.isBusy('docs/setup.md')).toBe(false);
    await tab.press('docs/setup.md', THEIRS);
    expect(posts().map((request) => request.param.conflictId)).toEqual([C1, C2]);
    expect(tab.card('docs/setup.md')).toBeUndefined();
    expect(tab.isBusy('docs/intro.md')).toBe(true);
    await answer.answer(resolved(posts()[0] as ResolveRequest));
    expect(tab.card('docs/intro.md')).toBeUndefined();
    expect(refreshed()).toEqual([detail('site-a'), detail('site-a')]);
  });

  it('keeps another site usable: each site resolves, refreshes and reports in its own panel', async () => {
    const a = page();
    const b = page();
    await a.open('site-a');
    await b.open('site-b');
    const answerA = held();
    const answerB = held();
    mocks.resolvePost.mockImplementationOnce(() => answerA.promise).mockImplementationOnce(() => answerB.promise);
    await a.press('docs/intro.md', OURS);
    expect(b.isBusy('docs/guide.md')).toBe(false);
    await b.press('docs/guide.md', DELETE);
    expect(posts().map((request) => request.param)).toEqual([
      { projectId: 'site-a', conflictId: C1 },
      { projectId: 'site-b', conflictId: C3 },
    ]);
    await answerB.answer(resolved(posts()[1] as ResolveRequest));
    expect(refreshed()).toEqual([detail('site-b')]);
    expect(a.isBusy('docs/intro.md')).toBe(true);
    await answerA.answer(json(409, { error: { message: 'Conflict changed' } }));
    expect(refreshed()).toEqual([detail('site-b')]);
    expect(a.isBusy('docs/intro.md')).toBe(false);
    // A 409 reads as the shared "changed elsewhere" wording, once.
    expect(mocks.error).toHaveBeenCalledTimes(1);
  });
});

describe('once sent, a resolution is never cancelled, retried or misreported', () => {
  it('keeps the custom text after a refusal, reports it once, refreshes nothing, and retries with the same body', async () => {
    const tab = page();
    await tab.open('site-a');
    await tab.type('docs/intro.md', 'merged\nمرحبًا');
    mocks.resolvePost.mockImplementationOnce(async () => json(409, { error: { message: 'Busy' } }));
    await tab.press('docs/intro.md', CUSTOM);
    expect(mocks.error).toHaveBeenCalledTimes(1);
    expect(refreshed()).toEqual([]);
    expect(tab.isBusy('docs/intro.md')).toBe(false);
    expect(tab.textarea('docs/intro.md')?.value).toBe('merged\nمرحبًا');
    await tab.press('docs/intro.md', CUSTOM);
    const body = { resolution: 'CUSTOM', content: 'merged\nمرحبًا' };
    expect(posts()).toEqual([
      { param: { projectId: 'site-a', conflictId: C1 }, json: body },
      { param: { projectId: 'site-a', conflictId: C1 }, json: body },
    ]);
    expect(refreshed()).toEqual([detail('site-a')]);
    expect(tab.card('docs/intro.md')).toBeUndefined();
  });

  it('does not retry a dropped request and keeps the custom text', async () => {
    const tab = page();
    await tab.open('site-a');
    await tab.type('docs/intro.md', '');
    mocks.resolvePost.mockImplementationOnce(async () => Promise.reject(new TypeError('fetch failed')));
    await tab.press('docs/intro.md', CUSTOM);
    expect(posts()).toHaveLength(1);
    expect(mocks.error).toHaveBeenCalledTimes(1);
    expect(refreshed()).toEqual([]);
    expect(tab.textarea('docs/intro.md')?.value).toBe('');
  });

  it('keeps the custom text, the request and its busy state through a refetch and a language change', async () => {
    const tab = page();
    await tab.open('site-a');
    await tab.type('docs/intro.md', 'draft in progress');
    await act(async () => void client.invalidateQueries({ queryKey: detail('site-a') }));
    await settle();
    expect(tab.textarea('docs/intro.md')?.value).toBe('draft in progress');
    const answer = held();
    mocks.resolvePost.mockImplementation(() => answer.promise);
    await tab.press('docs/intro.md', CUSTOM);
    mocks.locale = 'ar';
    await tab.open('site-a');
    expect(tab.isBusy('docs/intro.md')).toBe(true);
    expect(tab.textarea('docs/intro.md')?.value).toBe('draft in progress');
    await answer.answer(json(500, { error: { message: 'Boom' } }));
    expect(mocks.error.mock.calls).toEqual([[ERROR()]]);
    expect(tab.textarea('docs/intro.md')?.value).toBe('draft in progress');
  });

  it('shows the conflict busy after a keyed A → B → A while it resolves, sends nothing more, and refreshes site A', async () => {
    const tab = page();
    await tab.open('site-a');
    const answer = held();
    mocks.resolvePost.mockImplementation(() => answer.promise);
    await tab.press('docs/intro.md', OURS);
    await tab.open('site-b');
    expect(tab.isBusy('docs/guide.md')).toBe(false);
    await tab.open('site-a');
    expect(tab.isBusy('docs/intro.md')).toBe(true);
    expect(tab.isBusy('docs/setup.md')).toBe(false);
    await tab.press('docs/intro.md', THEIRS);
    expect(posts()).toEqual([{ param: { projectId: 'site-a', conflictId: C1 }, json: { resolution: 'OURS' } }]);
    await answer.answer(resolved(posts()[0] as ResolveRequest));
    expect(refreshed()).toEqual([detail('site-a')]);
    expect(tab.card('docs/intro.md')).toBeUndefined();
  });

  it('refreshes the site it was sent for after leaving (keyed), and reports nothing', async () => {
    const tab = page();
    await tab.open('site-a');
    const answer = held();
    mocks.resolvePost.mockImplementation(() => answer.promise);
    await tab.press('docs/intro.md', OURS);
    await tab.open('site-b');
    await answer.answer(resolved(posts()[0] as ResolveRequest));
    expect(refreshed()).toEqual([detail('site-a')]);
    expect(mocks.error).not.toHaveBeenCalled();
    expect(tab.card('docs/guide.md')).toBeDefined();
  });

  it('reports a late refusal neither after leaving (keyed) nor into the panel that replaced it', async () => {
    const tab = page();
    await tab.open('site-a');
    const answer = held();
    mocks.resolvePost.mockImplementation(() => answer.promise);
    await tab.press('docs/intro.md', OURS);
    await tab.open('site-b');
    await answer.answer(json(409, { error: { message: 'Late' } }));
    expect(mocks.error).not.toHaveBeenCalled();
    expect(refreshed()).toEqual([]);
    expect(posts()).toHaveLength(1);
  });

  it('does not report a late refusal after a refetch took the conflict off the list', async () => {
    const tab = page();
    await tab.open('site-a');
    const answer = held();
    mocks.resolvePost.mockImplementation(() => answer.promise);
    await tab.press('docs/intro.md', OURS);
    // Resolved elsewhere: the Refresh button's read no longer lists it.
    open['site-a'] = [conflict(C2, 'docs/setup.md')];
    await act(async () => void client.refetchQueries({ queryKey: detail('site-a') }));
    await settle();
    expect(tab.card('docs/intro.md')).toBeUndefined();
    await answer.answer(json(409, { error: { message: 'Late' } }));
    expect(mocks.error).not.toHaveBeenCalled();
    expect(tab.isBusy('docs/setup.md')).toBe(false);
  });

  it('a session change drops the old resolution’s refresh and report, and the remounted panel is usable', async () => {
    const tab = page();
    await tab.open('site-a', 'session-1');
    const answer = held();
    mocks.resolvePost.mockImplementationOnce(() => answer.promise);
    await tab.press('docs/intro.md', OURS);
    await act(async () => resetDashboardSession(client));
    // AppGuard remounts the dashboard for the new session.
    await tab.open('site-a', 'session-2');
    expect(tab.isBusy('docs/intro.md')).toBe(false);
    await answer.drop(new TypeError('fetch failed'));
    expect(mocks.error).not.toHaveBeenCalled();
    await tab.press('docs/intro.md', THEIRS);
    expect(posts().map((request) => request.json)).toEqual([{ resolution: 'OURS' }, { resolution: 'THEIRS' }]);
    expect(refreshed()).toEqual([detail('site-a')]);
  });

  it('programmatic: one instance moved to another site (same conflict id) is not busy, and A’s success refreshes A only', async () => {
    open['site-b'] = [conflict(C1, 'docs/intro.md', 'ours of site B')];
    // B's status is already cached, so the moved panel never shows its loading skeleton: the card stays one instance.
    await client.prefetchQuery(gitWorkflowQueryOptions('site-b'));
    const tab = page();
    await tab.open('site-a', null);
    const answer = held();
    mocks.resolvePost.mockImplementationOnce(() => answer.promise);
    await tab.press('docs/intro.md', OURS);
    const card = tab.textarea('docs/intro.md');
    await tab.open('site-b', null);
    expect(tab.textarea('docs/intro.md')).toBe(card);
    expect(tab.isBusy('docs/intro.md')).toBe(false);
    expect(tab.textarea('docs/intro.md')?.value).toBe('ours of site B');
    await tab.press('docs/intro.md', THEIRS);
    expect(posts().map((request) => request.param)).toEqual([
      { projectId: 'site-a', conflictId: C1 },
      { projectId: 'site-b', conflictId: C1 },
    ]);
    await answer.answer(json(500, { error: { message: 'Late' } }));
    // A's failure belongs to the panel that is gone; B's resolution already refreshed B.
    expect(mocks.error).not.toHaveBeenCalled();
    expect(refreshed()).toEqual([detail('site-b')]);
  });

  it('programmatic: A’s success after one instance moved to another site refreshes A, not the site it shows', async () => {
    open['site-b'] = [conflict(C1, 'docs/intro.md', 'ours of site B')];
    // B's status is already cached, so the moved panel never shows its loading skeleton: the card stays one instance.
    await client.prefetchQuery(gitWorkflowQueryOptions('site-b'));
    const tab = page();
    await tab.open('site-a', null);
    const answer = held();
    mocks.resolvePost.mockImplementationOnce(() => answer.promise);
    await tab.press('docs/intro.md', OURS);
    const card = tab.textarea('docs/intro.md');
    await tab.open('site-b', null);
    expect(tab.textarea('docs/intro.md')).toBe(card);
    await answer.answer(resolved(posts()[0] as ResolveRequest));
    expect(refreshed()).toEqual([detail('site-a')]);
    expect(tab.card('docs/intro.md')).toBeDefined();
  });
});

describe('programmatic: one card instance shown another conflict (the panel keys cards by conflict, so not reachable there)', () => {
  it('starts the custom text from the new conflict, is not busy for it, and keeps A’s late refusal out of it', async () => {
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    hosts.push({ host, root });
    const show = async (item: Conflict) => {
      await act(async () =>
        root.render(
          <QueryClientProvider client={client}>
            <GitConflictCard conflict={item} projectId="site-a" />
          </QueryClientProvider>,
        ),
      );
      await settle();
    };
    const button = (label: Parameters<typeof translateFn>[0]) =>
      [...host.querySelectorAll<HTMLButtonElement>('button')].find((item) => item.textContent?.includes(t(label)));
    const first = conflict(C1, 'docs/intro.md');
    await show(first);
    const answer = held();
    mocks.resolvePost.mockImplementationOnce(() => answer.promise);
    await act(async () => button(OURS)?.click());
    await settle();
    const area = host.querySelector('textarea');
    await show(conflict(C2, 'docs/setup.md'));
    expect(host.querySelector('textarea')).toBe(area);
    expect(area?.value).toBe('ours of docs/setup.md');
    expect(button(DELETE)?.getAttribute('aria-busy')).toBeNull();
    await answer.answer(json(409, { error: { message: 'Late' } }));
    expect(mocks.error).not.toHaveBeenCalled();
    // Back to A while nothing is pending: its own text again, and its press sends A's request.
    await show(first);
    expect(host.querySelector('textarea')?.value).toBe('ours of docs/intro.md');
    await act(async () => button(THEIRS)?.click());
    await settle();
    expect(posts().map((request) => [request.param.conflictId, request.json])).toEqual([
      [C1, { resolution: 'OURS' }],
      [C1, { resolution: 'THEIRS' }],
    ]);
  });
});
