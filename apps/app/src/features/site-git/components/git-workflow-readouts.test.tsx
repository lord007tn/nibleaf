// @vitest-environment jsdom
// Settings → Git, connected: the status header, the pull request previews and the recent operations, moved out of
// GitWorkflow into git-workflow-readouts.tsx unchanged. The real GitWorkflow, its status query and the app's
// QueryClient render each one; main's inline code (pinned in __fixtures__/git-workflow-readouts-main.tsx, checked
// against `git show` below) renders the same status beside it with the real EN/AR catalogs, date formatting and
// FailureMessage, and the markup must match exactly. Only the HTTP calls are replaced; sites, repositories, pull
// requests and operations are fictional.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ConfirmProvider } from '@nibleaf/design-system/components/ui/confirm';
import { translateFn } from '@nibleaf/i18n';
import { QueryClientProvider } from '@tanstack/react-query';
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ locale: 'en' as 'en' | 'ar', statusGet: vi.fn() }));
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
vi.mock('@nibleaf/i18n/react', async () => {
  const { translateFn: translate } = await vi.importActual<typeof import('@nibleaf/i18n')>('@nibleaf/i18n');
  const t = (key: Parameters<typeof translate>[0], variables?: Parameters<typeof translate>[1]) => translate(key, variables, mocks.locale);
  return { useT: () => t, useLocale: () => ({ locale: mocks.locale, t }) };
});
vi.mock('@/env', () => ({ env: { VITE_APP_URL: 'https://app.fixture.test' } }));
// Every API call: only the status read is expected.
vi.mock('@/services/api', () => {
  const node = (path: string[]): unknown =>
    new Proxy(() => undefined, {
      get: (_target, property) => (typeof property === 'string' && property !== 'then' ? node([...path, property]) : undefined),
      apply: (_target, _this, args: unknown[]) => {
        const call = path.slice(3).join('.');
        if (call === 'git.$get') return mocks.statusGet((args[0] as { param: { projectId: string } }).param.projectId);
        throw new Error(`unexpected API call ${call}`);
      },
    });
  return { api: node([]) };
});

import { GitWorkflow } from '@/components/settings/git-workflow';
import type { GitWorkflowStatus } from '@/hooks/api';
import { queryKeys } from '@/hooks/api/query-keys';
import { createQueryClient } from '@/integrations/tanstack-query/query-client';
import { localeTag } from '@/lib/format';
import { MAIN_READOUTS_BASE, MainReadouts } from './__fixtures__/git-workflow-readouts-main';
import { GitWorkflowStatusHeader } from './git-workflow-readouts';

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);

type Intent = 'overview' | 'sync' | 'publish' | 'connection';
type Operation = GitWorkflowStatus['operations'][number];
type PullRequest = GitWorkflowStatus['pullRequests'][number];

const t = (key: Parameters<typeof translateFn>[0]) => translateFn(key, undefined, mocks.locale);
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const SITE = 'site-1';
const INTENTS: Intent[] = ['overview', 'sync', 'publish', 'connection'];
const LOCALES = ['en', 'ar'] as const;

const operation = (id: string, fields: Partial<Operation>): Operation => ({
  id,
  kind: 'PULL',
  status: 'SUCCEEDED',
  commitMessage: null,
  changedFiles: null,
  pullRequestNo: null,
  pullRequestUrl: null,
  error: null,
  createdAt: '2026-11-15T09:00:00.000Z',
  conflicts: [],
  ...fields,
});
const pull = (id: string, fields: Partial<PullRequest>): PullRequest => ({
  id,
  number: 1,
  url: `https://git.acme-fixture.test/handbook/pull/${id}`,
  title: 'Handbook refresh',
  draft: false,
  state: 'open',
  previews: [],
  ...fields,
});
const connection = (fields: Partial<GitWorkflowStatus>): GitWorkflowStatus => ({
  id: 'connection-1',
  repository: 'acme-fixture/handbook',
  baseBranch: 'main',
  headBranch: 'nibleaf/docs',
  contentPath: 'docs',
  credentialConfigured: true,
  webhookConfigured: true,
  lastSyncStatus: 'SUCCEEDED',
  lastSyncError: null,
  lastSyncedAt: '2026-11-15T09:00:00.000Z',
  operations: [],
  pullRequests: [],
  files: [],
  ...fields,
});

/** Nothing yet: no operation, no pull request, an unknown last-sync status. */
const EMPTY = connection({ lastSyncStatus: 'IDLE', lastSyncedAt: null });
/**
 * Every operation status and an unknown one, listed out of date order; changed files absent, empty and populated
 * (Arabic paths); messages and errors null and set. Pull requests open, draft, closed and merged with zero, one and
 * several previews, listed out of order (the first listed is shown, not the newest or the ready one).
 */
const MIXED = connection({
  repository: 'acme-fixture/دليل',
  operations: [
    operation('op-1', {
      kind: 'PUSH',
      commitMessage: 'تحديث الدليل',
      changedFiles: [
        { path: 'docs/دليل/مقدمة.mdx', status: 'modified' },
        { path: 'docs/guide.mdx', status: 'added' },
      ],
      createdAt: '2026-11-14T08:30:00.000Z',
    }),
    operation('op-2', { status: 'QUEUED', createdAt: '2026-11-15T10:00:00.000Z' }),
    operation('op-3', { status: 'RUNNING', changedFiles: [], createdAt: '2026-11-13T23:59:59.000Z' }),
    operation('op-4', { kind: 'PUSH', status: 'FAILED', commitMessage: 'Fixture message', error: 'Bad credentials: provider trace' }),
    operation('op-5', {
      status: 'CONFLICT',
      changedFiles: [{ path: 'docs/a.mdx', status: 'conflict' }],
      error: 'rejected: non-fast-forward',
      createdAt: '2026-01-02T03:04:05.000Z',
    }),
    operation('op-6', { kind: 'PUSH', status: 'READY', pullRequestNo: 12, pullRequestUrl: 'https://git.acme-fixture.test/handbook/pull/12' }),
    operation('op-7', { kind: 'REBASE', status: 'PAUSED', error: 'ProviderError: something odd' }),
  ],
  pullRequests: [
    pull('pr-1', { number: 12, title: 'Handbook refresh' }),
    pull('pr-2', { number: 7, title: 'مسودة الدليل', draft: true, previews: [{ id: 'pv-1', status: 'BUILDING', url: null, error: null }] }),
    pull('pr-3', {
      number: 3,
      state: 'closed',
      previews: [
        { id: 'pv-9', status: 'FAILED', url: null, error: 'build failed' },
        { id: 'pv-2', status: 'READY', url: 'https://preview.acme-fixture.test/pr-3', error: null },
      ],
    }),
    pull('pr-4', {
      number: 4,
      state: 'merged',
      previews: [
        { id: 'pv-5', status: 'READY', url: 'https://preview.acme-fixture.test/pr-4', error: null },
        { id: 'pv-4', status: 'BUILDING', url: null, error: null },
        { id: 'pv-3', status: 'FAILED', url: null, error: 'x' },
      ],
    }),
    pull('pr-5', { number: 5, previews: [{ id: 'pv-6', status: 'WAITING', url: 'https://preview.acme-fixture.test/pr-5', error: null }] }),
    pull('pr-6', { number: 6, title: 'Closed draft', draft: true, state: 'closed' }),
  ],
});
/** The last sync failed (access), and an operation failed with a connection error and no files. */
const FAILURE = connection({
  lastSyncStatus: 'FAILED',
  lastSyncError: 'Bad credentials: provider trace',
  operations: [operation('op-8', { status: 'FAILED', error: 'fetch failed', changedFiles: null })],
});
/** The last sync conflicted; no conflict is open (the conflict card is not part of this change). */
const CONFLICTED = connection({
  lastSyncStatus: 'CONFLICT',
  lastSyncError: 'rejected: non-fast-forward',
  operations: [operation('op-9', { status: 'CONFLICT', changedFiles: [] })],
  pullRequests: [pull('pr-7', { number: 9, previews: [] })],
});
const SCENARIOS = { EMPTY, MIXED, FAILURE, CONFLICTED } as const;

/** Lets queries settle: TanStack tells React on a timer, so each tick gets its own act. */
const settle = async () => {
  for (let tick = 0; tick < 4; tick += 1) await act(async () => new Promise((done) => setTimeout(done, 0)));
};

let client: ReturnType<typeof createQueryClient>;
const mounted: Array<{ host: HTMLDivElement; root: Root }> = [];
async function mount(node: ReactNode) {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  mounted.push({ host, root });
  await act(async () =>
    root.render(
      <QueryClientProvider client={client}>
        <ConfirmProvider>{node}</ConfirmProvider>
      </QueryClientProvider>,
    ),
  );
  await settle();
  return host;
}
const button = (scope: ParentNode, label: string) => [...scope.querySelectorAll('button')].find((item) => item.textContent?.includes(label)) ?? null;
/** This branch: the real GitWorkflow, showing `intent`. */
async function host(data: GitWorkflowStatus, intent: Intent, projectId = SITE) {
  mocks.statusGet.mockImplementation(async () => json(200, { data }));
  const node = await mount(<GitWorkflow projectId={projectId} />);
  if (intent !== 'overview') {
    await act(async () => button(node.querySelector('nav') as HTMLElement, t(`settings.git.workflow.nav.${intent}`))?.click());
    await settle();
  }
  return node.firstElementChild as HTMLElement;
}
/** Main: its inline readouts, for the same status, panel and query state. */
async function main(data: GitWorkflowStatus, intent: Intent, isFetching = false) {
  const refetch = vi.fn();
  const node = await mount(<MainReadouts connection={data} intent={intent} query={{ isFetching, refetch }} />);
  return { readouts: node.firstElementChild as HTMLElement, refetch };
}
const sectionWithHeading = (scope: HTMLElement, tag: 'h2' | 'h3', text: string) =>
  [...scope.querySelectorAll(tag)].find((heading) => heading.textContent === text)?.closest('section') ?? null;
/** The three readouts' markup (null when not shown). */
const readouts = (scope: HTMLElement) => ({
  header: sectionWithHeading(scope, 'h2', t('settings.git.workflow.title'))?.outerHTML ?? null,
  previews: sectionWithHeading(scope, 'h3', t('settings.git.workflow.previewsTitle'))?.outerHTML ?? null,
  operations: sectionWithHeading(scope, 'h3', t('settings.git.workflow.recentOperations'))?.outerHTML ?? null,
});
/**
 * Markup with each element's attributes sorted. A busy state applied by an update appends its attributes after the
 * ones the first render set, so a busy Refresh is compared as content, not attribute order.
 */
const canonical = (node: Node): string => {
  if (!(node instanceof Element)) return node.textContent ?? '';
  const attributes = [...node.attributes].map(({ name, value }) => `${name}="${value}"`).sort();
  return `<${node.tagName} ${attributes.join(' ')}>${[...node.childNodes].map(canonical).join('')}</${node.tagName}>`;
};
const headerOf = (scope: HTMLElement) => sectionWithHeading(scope, 'h2', t('settings.git.workflow.title')) as HTMLElement;
/** What the connected screen shows, top to bottom: the header, the nav, then each section by its heading. */
const layout = (scope: HTMLElement) =>
  // A section kept mounted but hidden (the Connection configuration on other panels) is not shown.
  [...scope.children]
    .filter((child) => !(child as HTMLElement).hidden)
    .map((child) =>
      child.querySelector('h2')?.textContent === t('settings.git.workflow.title')
        ? 'header'
        : child.tagName === 'NAV'
          ? 'nav'
          : (child.querySelector('h3')?.textContent ?? child.tagName),
    );

beforeEach(() => {
  mocks.locale = 'en';
  client = createQueryClient();
  mocks.statusGet.mockReset();
});
afterEach(async () => {
  for (const { host: node, root } of mounted.splice(0)) {
    await act(async () => root.unmount());
    node.remove();
  }
  client.clear();
});

describe('the connected readouts render exactly as main rendered them inline', () => {
  describe.each(LOCALES)('%s', (locale) => {
    it.each(Object.keys(SCENARIOS) as Array<keyof typeof SCENARIOS>)('%s, in every panel', async (scenario) => {
      mocks.locale = locale;
      for (const intent of INTENTS) {
        const after = await host(SCENARIOS[scenario], intent);
        const before = await main(SCENARIOS[scenario], intent);
        expect(readouts(after), `${scenario} ${intent}`).toEqual(readouts(before.readouts));
        expect(readouts(after).header, 'the header is always shown').not.toBeNull();
        // The host keeps main's conditions and order: previews on Overview and Update PR, history on Overview and Sync.
        expect(layout(after)).toEqual(
          {
            overview: ['header', 'nav', t('settings.git.workflow.previewsTitle'), t('settings.git.workflow.recentOperations')],
            sync: ['header', 'nav', t('settings.git.workflow.syncTitle'), t('settings.git.workflow.recentOperations')],
            publish: ['header', 'nav', t('settings.git.workflow.publishTitle'), t('settings.git.workflow.previewsTitle')],
            connection: ['header', 'nav', t('settings.git.webhook.title'), t('settings.git.workflow.configuration')],
          }[intent],
        );
        for (const { host: node, root } of mounted.splice(0)) {
          await act(async () => root.unmount());
          node.remove();
        }
        client.clear();
      }
    });

    it.each(['SUCCEEDED', 'READY', 'FAILED', 'CONFLICT', 'QUEUED', 'RUNNING', 'PAUSED'])('the header with a last sync %s', async (status) => {
      mocks.locale = locale;
      const data = connection({ lastSyncStatus: status, lastSyncError: status === 'FAILED' ? 'timed out' : null });
      expect(readouts(await host(data, 'overview')).header).toBe(readouts((await main(data, 'overview')).readouts).header);
    });
  });

  it('shows each pull request with its first listed preview, untranslated states and statuses, and the links as they were', async () => {
    const shown = await host(MIXED, 'overview');
    const previews = sectionWithHeading(shown, 'h3', t('settings.git.workflow.previewsTitle')) as HTMLElement;
    const rows = [...previews.querySelectorAll(':scope > div > div')].map((row) => ({
      badge: row.querySelector('[data-slot="badge"]')?.textContent,
      links: [...row.querySelectorAll('a')].map((link) => ({
        name: link.textContent,
        href: link.getAttribute('href'),
        target: link.getAttribute('target'),
        rel: link.getAttribute('rel'),
      })),
      preview: row.querySelector('.ms-auto')?.textContent,
    }));
    const pending = t('settings.git.workflow.pending');
    const label = t('settings.git.workflow.preview');
    const pr = (id: string, number: number, title: string) => ({
      name: `#${number} ${title} `,
      href: `https://git.acme-fixture.test/handbook/pull/${id}`,
      target: '_blank',
      rel: 'noreferrer',
    });
    const open = (url: string) => ({ name: t('settings.git.workflow.openPreview'), href: url, target: '_blank', rel: 'noreferrer' });
    expect(rows).toEqual([
      { badge: 'open', links: [pr('pr-1', 12, 'Handbook refresh')], preview: `${label}: ${pending}` },
      { badge: t('settings.git.workflow.draft'), links: [pr('pr-2', 7, 'مسودة الدليل')], preview: `${label}: BUILDING` },
      // The first listed preview failed and has no link, although a later one is ready.
      { badge: 'closed', links: [pr('pr-3', 3, 'Handbook refresh')], preview: `${label}: FAILED` },
      {
        badge: 'merged',
        links: [pr('pr-4', 4, 'Handbook refresh'), open('https://preview.acme-fixture.test/pr-4')],
        preview: `${label}: READY`,
      },
      { badge: 'open', links: [pr('pr-5', 5, 'Handbook refresh'), open('https://preview.acme-fixture.test/pr-5')], preview: `${label}: WAITING` },
      // Draft wins over the closed state.
      { badge: t('settings.git.workflow.draft'), links: [pr('pr-6', 6, 'Closed draft')], preview: `${label}: ${pending}` },
    ]);
  });

  it.each(LOCALES)('lists the operations in the order given, dated with the locale tag, with their files and failures (%s)', async (locale) => {
    mocks.locale = locale;
    const shown = await host(MIXED, 'sync');
    const history = sectionWithHeading(shown, 'h3', t('settings.git.workflow.recentOperations')) as HTMLElement;
    const items = [...history.querySelectorAll(':scope > div > div')];
    expect(items.map((item) => item.querySelector('.text-sm')?.textContent)).toEqual([
      'PUSH تحديث الدليل',
      'PULL ',
      'PULL ',
      'PUSH Fixture message',
      'PULL ',
      'PUSH ',
      'REBASE ',
    ]);
    expect(items.map((item) => item.querySelector('[data-slot="badge"]')?.textContent)).toEqual([
      'SUCCEEDED',
      'QUEUED',
      'RUNNING',
      'FAILED',
      'CONFLICT',
      'READY',
      'PAUSED',
    ]);
    expect(items.map((item) => item.querySelector('.ms-auto')?.textContent)).toEqual(
      MIXED.operations.map((item) => new Date(item.createdAt).toLocaleString(localeTag(locale))),
    );
    // Files: populated lists only (absent and empty show nothing), each path as given.
    expect(items.map((item) => [...item.querySelectorAll('li')].map((file) => file.textContent))).toEqual([
      ['modified: docs/دليل/مقدمة.mdx', 'added: docs/guide.mdx'],
      [],
      [],
      [],
      ['conflict: docs/a.mdx'],
      [],
      [],
    ]);
    // Failures go through FailureMessage (context git), its details collapsed.
    expect(items.map((item) => item.querySelector('p.text-destructive')?.textContent ?? null)).toEqual([
      null,
      null,
      null,
      t('failures.access'),
      t('failures.conflict'),
      null,
      t('failures.git'),
    ]);
    expect(items[3]?.querySelector('details')?.open).toBe(false);
    expect(items[3]?.querySelector('pre')?.textContent).toBe('Bad credentials: provider trace');
  });
});

describe('Refresh and the status query stay the host’s', () => {
  it('a Refresh press reads the status once, busy as main was while it runs', async () => {
    const shown = await host(FAILURE, 'overview');
    expect(mocks.statusGet).toHaveBeenCalledTimes(1);
    let answer: (response: Response) => void = () => undefined;
    mocks.statusGet.mockImplementationOnce(
      () =>
        new Promise<Response>((done) => {
          answer = done;
        }),
    );
    const refresh = button(shown, t('common.refresh')) as HTMLButtonElement;
    await act(async () => refresh.click());
    await settle();
    expect(mocks.statusGet).toHaveBeenCalledTimes(2);
    expect(refresh.getAttribute('aria-busy')).toBe('true');
    expect(refresh.disabled).toBe(true);
    // Busy, it is natively disabled, as on main: another press reads nothing more.
    await act(async () => refresh.click());
    await settle();
    expect(mocks.statusGet).toHaveBeenCalledTimes(2);
    const busy = await main(FAILURE, 'overview', true);
    expect(canonical(headerOf(shown))).toBe(canonical(headerOf(busy.readouts)));
    await act(async () => answer(json(200, { data: FAILURE })));
    await settle();
    expect(refresh.getAttribute('aria-busy')).toBeNull();
    expect(refresh.disabled).toBe(false);
    expect(canonical(headerOf(shown))).toBe(canonical(headerOf((await main(FAILURE, 'overview')).readouts)));
    // Main's Refresh called the query's refetch once per press, with nothing else.
    await act(async () => (button(busy.readouts, t('common.refresh')) as HTMLButtonElement).click());
    expect(busy.refetch).not.toHaveBeenCalled();
    const idle = await main(FAILURE, 'overview');
    await act(async () => (button(idle.readouts, t('common.refresh')) as HTMLButtonElement).click());
    expect(idle.refetch).toHaveBeenCalledTimes(1);
    expect(idle.refetch).toHaveBeenCalledWith();
  });

  it('the header calls back once per press, with no argument, and not while refreshing', async () => {
    const onRefresh = vi.fn();
    const shown = await mount(<GitWorkflowStatusHeader connection={EMPTY} onRefresh={onRefresh} refreshing={false} />);
    await act(async () => (button(shown, t('common.refresh')) as HTMLButtonElement).click());
    expect(onRefresh).toHaveBeenCalledTimes(1);
    expect(onRefresh).toHaveBeenCalledWith();
    const busy = await mount(<GitWorkflowStatusHeader connection={EMPTY} onRefresh={onRefresh} refreshing />);
    await act(async () => (button(busy, t('common.refresh')) as HTMLButtonElement).click());
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });

  it('keeps one observer on the status, polling every 2.5 s only while an operation is queued or running', async () => {
    await host(MIXED, 'overview', 'site-running');
    await host(FAILURE, 'sync', 'site-settled');
    const observers = (projectId: string) => client.getQueryCache().find({ queryKey: queryKeys.gitWorkflow.detail(projectId) })?.observers ?? [];
    expect(observers('site-running')).toHaveLength(1);
    expect(observers('site-settled')).toHaveLength(1);
    expect(client.getQueryCache().getAll()).toHaveLength(2);
    const reads = (projectId: string) => mocks.statusGet.mock.calls.filter(([id]) => id === projectId).length;
    expect([reads('site-running'), reads('site-settled')]).toEqual([1, 1]);
    await act(async () => new Promise((done) => setTimeout(done, 2700)));
    await settle();
    expect([reads('site-running'), reads('site-settled')]).toEqual([2, 1]);
  });

  it('the readouts own no query, request or cache write', () => {
    const source = readFileSync(resolve(import.meta.dirname, 'git-workflow-readouts.tsx'), 'utf8');
    expect(source).not.toMatch(/use(?:Query|Mutation|QueryClient|GitWorkflow|Session)\b|refetch\(|invalidate|setQueryData|@\/services\//);
    expect(source.match(/from '@\/hooks\/api[^']*'/g)).toEqual(["from '@/hooks/api'"]);
    expect(source).toContain("import type { GitWorkflowStatus } from '@/hooks/api';");
    const workflow = readFileSync(resolve(import.meta.dirname, '../../../components/settings/git-workflow.tsx'), 'utf8');
    expect(workflow.match(/useGitWorkflow\(/g)).toHaveLength(1);
    expect(workflow).toContain('onRefresh={() => query.refetch()} refreshing={query.isFetching}');
  });
});

// Shallow clones (CI's unit shards) don't have the pinned commit; a full clone checks the fixture against it.
const mainSource = (() => {
  try {
    return execFileSync('git', ['show', `${MAIN_READOUTS_BASE}:apps/app/src/components/settings/git-workflow.tsx`], {
      cwd: import.meta.dirname,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).replaceAll('\r\n', '\n');
  } catch {
    return null;
  }
})();
it.skipIf(!mainSource)('the "before" fixture is main’s code at the pinned commit, verbatim', () => {
  const source = mainSource ?? '';
  const fixture = readFileSync(resolve(import.meta.dirname, '__fixtures__/git-workflow-readouts-main.tsx'), 'utf8').replaceAll('\r\n', '\n');
  const slice = (start: string, end: string) => {
    expect(source.split(start)).toHaveLength(2);
    const from = source.indexOf(start);
    return source.slice(from, source.indexOf(end, from) + end.length);
  };
  for (const block of [
    slice('const statusTone', "'secondary';"),
    slice('      <section className="rounded-xl border border-primary/20 bg-primary/5 p-5">', '\n      </section>'),
    slice("      {intent === 'overview' || intent === 'publish' ? (", '\n      ) : null}'),
    slice("      {intent === 'overview' || intent === 'sync' ? (", '\n      ) : null}'),
  ]) {
    expect(block.length).toBeGreaterThan(80);
    expect(fixture).toContain(block);
  }
});
