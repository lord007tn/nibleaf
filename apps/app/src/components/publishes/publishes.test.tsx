// @vitest-environment jsdom
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  history: vi.fn(),
  detail: vi.fn(),
  deployments: vi.fn(),
  edit: { value: 'edit' as string },
  rollback: vi.fn(),
  pipeline: vi.fn(),
  params: { projectId: 'site-1' } as Record<string, string>,
}));

vi.mock('@nibleaf/i18n/react', () => ({
  useT: () => (key: string, vars?: Record<string, unknown>) => (vars ? `${key}(${Object.values(vars).join('|')})` : key),
}));
vi.mock('@nibleaf/i18n/locale-state', () => ({ getLocale: () => 'en', renderedLocale: () => 'en', subscribeLanguage: () => () => undefined }));
vi.mock('@tanstack/react-router', () => ({
  useParams: () => mocks.params,
  Link: ({ children, to, params, className }: { children: ReactNode; to: string; params?: Record<string, string>; className?: string }) => (
    <a className={className} data-params={JSON.stringify(params ?? {})} data-to={to} href="/link">
      {children}
    </a>
  ),
}));
vi.mock('@/hooks/api/publish-history', () => ({
  usePublishHistory: () => mocks.history(),
  usePublishHistoryDetail: () => mocks.detail(),
}));
vi.mock('@/hooks/api', () => ({
  friendlyErrorMessage: (_t: unknown, _error: unknown, key: string) => key,
  useDeployments: () => mocks.deployments(),
  useProject: () => ({ data: { id: 'site-1', slug: 'docs', name: 'Docs' } }),
  useRollback: () => ({ mutateAsync: mocks.rollback, isPending: false }),
}));
vi.mock('@/hooks/use-project-admin-status', () => ({ useProjectAdminStatus: () => ({ edit: mocks.edit.value }) }));
vi.mock('../project/deploy-pipeline', async (importActual) => ({
  ...(await importActual<typeof import('../project/deploy-pipeline')>()),
  DeployPipeline: (props: Record<string, unknown>) => {
    mocks.pipeline(props);
    return null;
  },
}));

import PublishVersionPage from './publish-version-page';
import PublishesPage from './publishes-page';

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);

const item = (version: number, status: string, extra: Record<string, unknown> = {}) => ({
  id: `dep-${version}`,
  version,
  status,
  pagesCount: 12,
  commitMessage: null,
  createdAt: '2026-11-01T10:00:00.000Z',
  completedAt: status === 'READY' || status === 'FAILED' ? '2026-11-01T10:01:00.000Z' : null,
  publishedBy: 'Fictional Editor',
  snapshotAvailable: status === 'READY',
  ...extra,
});

const page = (items: ReturnType<typeof item>[], live: { id: string; version: number } | null, nextCursor: number | null = null) => ({
  items,
  nextCursor,
  live,
});

const historyResult = (pages: ReturnType<typeof page>[], extra: Record<string, unknown> = {}) => ({
  data: { pages, pageParams: [] },
  isPending: false,
  isError: false,
  hasNextPage: false,
  isFetchingNextPage: false,
  fetchNextPage: vi.fn(),
  refetch: vi.fn(),
  ...extra,
});

let host: HTMLDivElement;
let root: Root;
const render = async (node: ReactNode) => {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root.render(node));
  return host;
};
/** Opens the version page at /publishes/<deploymentId>. */
const showVersion = (deploymentId: string) => {
  mocks.params = { projectId: 'site-1', deploymentId };
  return render(<PublishVersionPage />);
};
const rowOf = (version: number) => host.querySelector<HTMLElement>(`[data-version="${version}"]`);
const actionsTrigger = (version: number) =>
  [...(rowOf(version)?.querySelectorAll('button') ?? [])].find((button) =>
    button.getAttribute('aria-label')?.startsWith('settings.visibility.actionsFor'),
  );

beforeEach(() => {
  mocks.params = { projectId: 'site-1' };
  mocks.edit.value = 'edit';
  mocks.deployments.mockReturnValue({ data: undefined });
  mocks.rollback.mockResolvedValue({ id: 'dep-restore', version: 9, status: 'PENDING' });
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  document.body.innerHTML = '';
  vi.clearAllMocks();
});

describe('Publishes page', () => {
  it('lists every attempt newest first, marks the live version, and links each to its detail', async () => {
    mocks.history.mockReturnValue(
      historyResult([
        page([item(5, 'BUILDING'), item(4, 'FAILED'), item(3, 'READY', { commitMessage: 'Fix typos' }), item(2, 'READY')], {
          id: 'dep-3',
          version: 3,
        }),
      ]),
    );
    await render(<PublishesPage />);
    const versions = [...host.querySelectorAll('[data-version]')].map((row) => row.getAttribute('data-version'));
    expect(versions).toEqual(['5', '4', '3', '2']);
    const states = [...host.querySelectorAll('[data-version] [data-slot="status-badge"]')].map((badge) => badge.getAttribute('data-state'));
    expect(states).toEqual(['building', 'failed', 'live', 'superseded']);
    expect(host.querySelectorAll('[data-live]')).toHaveLength(1);
    expect(rowOf(3)?.textContent).toContain('Fix typos');
    expect(rowOf(3)?.textContent).toContain('Fictional Editor');
    expect(rowOf(2)?.textContent).toContain('overview.activity.publish');
    const link = rowOf(4)?.querySelector('a');
    expect(link?.getAttribute('data-to')).toBe('/app/projects/$projectId/publishes/$deploymentId');
    expect(JSON.parse(link?.getAttribute('data-params') ?? '{}')).toEqual({ projectId: 'site-1', deploymentId: 'dep-4' });
  });

  it('takes the newest live version from the polled publish list when it is ahead of the history', async () => {
    mocks.history.mockReturnValue(historyResult([page([item(3, 'BUILDING'), item(2, 'READY')], { id: 'dep-2', version: 2 })]));
    // The publish dialog's poll already saw v3 go live.
    mocks.deployments.mockReturnValue({ data: [item(3, 'READY'), item(2, 'READY')] });
    await render(<PublishesPage />);
    expect(rowOf(2)?.querySelector('[data-slot="status-badge"]')?.getAttribute('data-state')).toBe('superseded');
    expect(rowOf(3)?.hasAttribute('data-live')).toBe(true);
  });

  it('offers Restore only on older published versions, never on the live one or a failed or running attempt', async () => {
    mocks.history.mockReturnValue(
      historyResult([page([item(5, 'PENDING'), item(4, 'FAILED'), item(3, 'READY'), item(2, 'READY')], { id: 'dep-3', version: 3 })]),
    );
    await render(<PublishesPage />);
    expect(actionsTrigger(5)).toBeUndefined();
    expect(actionsTrigger(4)).toBeUndefined();
    expect(actionsTrigger(3)).toBeUndefined();
    expect(actionsTrigger(2)).toBeDefined();
  });

  it('confirms, restores through the rollback mutation and follows it in the publish dialog as a restore', async () => {
    mocks.history.mockReturnValue(historyResult([page([item(3, 'READY'), item(2, 'READY')], { id: 'dep-3', version: 3 })]));
    await render(<PublishesPage />);
    await act(async () => actionsTrigger(2)?.click());
    const restore = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find((entry) =>
      entry.textContent?.startsWith('publishes.restore'),
    );
    await act(async () => restore?.click());
    const dialog = document.querySelector('[data-slot="action-dialog"]');
    expect(dialog?.textContent).toContain('deploy.rollback.confirmDesc(2)');
    expect(mocks.rollback).not.toHaveBeenCalled();
    const confirm = [...(dialog?.querySelectorAll('button') ?? [])].find((button) => button.getAttribute('type') === 'submit');
    await act(async () => confirm?.click());
    expect(mocks.rollback).toHaveBeenCalledWith('dep-2');
    expect(mocks.pipeline).toHaveBeenLastCalledWith(
      expect.objectContaining({ open: true, trackedDeploymentId: 'dep-restore', restoring: { targetId: 'dep-2', version: 2 } }),
    );
  });

  it('keeps Restore visible but disabled, with the reason, for a Viewer', async () => {
    mocks.edit.value = 'viewOnly';
    mocks.history.mockReturnValue(historyResult([page([item(3, 'READY'), item(2, 'READY')], { id: 'dep-3', version: 3 })]));
    await render(<PublishesPage />);
    await act(async () => actionsTrigger(2)?.click());
    const restore = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find((entry) =>
      entry.textContent?.startsWith('publishes.restore'),
    );
    expect(restore?.getAttribute('aria-disabled')).toBe('true');
    expect(restore?.textContent).toContain('access.viewOnly.publish');
    await act(async () => restore?.click());
    expect(document.querySelector('[data-slot="action-dialog"]')).toBeNull();
  });

  it('keeps a failure with an automatic retry to come in progress, then shows where the retry landed', async () => {
    // The worker records FAILED with no completion time while BullMQ still has a retry.
    const retrying = { ...item(3, 'FAILED'), completedAt: null };
    mocks.history.mockReturnValue(historyResult([page([retrying, item(2, 'READY')], { id: 'dep-2', version: 2 })]));
    await render(<PublishesPage />);
    expect(rowOf(3)?.querySelector('[data-slot="status-badge"]')?.getAttribute('data-state')).toBe('building');
    expect(actionsTrigger(3)).toBeUndefined();
    mocks.history.mockReturnValue(historyResult([page([item(3, 'READY'), item(2, 'READY')], { id: 'dep-3', version: 3 })]));
    await act(async () => root.render(<PublishesPage />));
    expect(rowOf(3)?.querySelector('[data-slot="status-badge"]')?.getAttribute('data-state')).toBe('live');
  });

  it('disables Restore with the reason when a version’s published copy is no longer stored', async () => {
    mocks.history.mockReturnValue(
      historyResult([page([item(3, 'READY'), { ...item(2, 'READY'), snapshotAvailable: false }], { id: 'dep-3', version: 3 })]),
    );
    await render(<PublishesPage />);
    await act(async () => actionsTrigger(2)?.click());
    const restore = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find((entry) =>
      entry.textContent?.startsWith('publishes.restore'),
    );
    expect(restore?.getAttribute('aria-disabled')).toBe('true');
    expect(restore?.textContent).toContain('publishes.noSnapshot');
  });

  it('pages back through older publishes', async () => {
    const fetchNextPage = vi.fn();
    mocks.history.mockReturnValue(historyResult([page([item(25, 'READY')], { id: 'dep-25', version: 25 }, 6)], { hasNextPage: true, fetchNextPage }));
    await render(<PublishesPage />);
    const more = [...host.querySelectorAll('button')].find((button) => button.textContent === 'editor.history.more');
    await act(async () => more?.click());
    expect(fetchNextPage).toHaveBeenCalledOnce();
  });

  it('says nothing was published yet on a new site', async () => {
    mocks.history.mockReturnValue(historyResult([page([], null)]));
    await render(<PublishesPage />);
    expect(host.textContent).toContain('overview.activity.empty');
  });
});

const summary = (extra: Record<string, unknown> = {}) => ({
  status: 'ready',
  previous: { id: 'dep-1', version: 1 },
  totals: { added: 1, modified: 1, removed: 1 },
  changes: [
    { id: 'p-new', title: 'Brand new', path: 'guides/new', languageCode: 'en', kind: 'PAGE', status: 'added' },
    { id: 'p-edit', title: 'Edited', path: 'edited', languageCode: 'en', kind: 'PAGE', status: 'modified' },
    { id: 'p-gone', title: 'Gone', path: 'gone', languageCode: 'ar', kind: 'PAGE', status: 'removed' },
  ],
  truncated: false,
  settingsChanged: false,
  ...extra,
});
const detail = (deployment: ReturnType<typeof item> & Record<string, unknown>, live: { id: string; version: number } | null, value: unknown) => ({
  data: { deployment: { error: null, errorDetails: null, ...deployment }, live, summary: value },
  isPending: false,
  isError: false,
  refetch: vi.fn(),
});

describe('Publish version page', () => {
  it('shows what the version added, edited and removed against the previous one, and offers Restore', async () => {
    mocks.detail.mockReturnValue(detail(item(2, 'READY'), { id: 'dep-3', version: 3 }, summary({ settingsChanged: true })));
    await showVersion('dep-2');
    expect(host.querySelector('h1')?.textContent).toBe('editor.history.version(2)');
    expect(host.querySelector('h2')?.textContent).toBe('publishes.changesSince(1)');
    const changes = [...host.querySelectorAll('[data-change]')].map((row) => [row.getAttribute('data-change'), row.textContent]);
    expect(changes).toEqual([
      ['added', expect.stringContaining('Brand new')],
      ['modified', expect.stringContaining('Edited')],
      ['removed', expect.stringContaining('Gone')],
    ]);
    expect(host.textContent).toContain('/guides/new');
    expect(host.textContent).toContain('publishes.settingsChanged');
    expect(host.querySelector('[data-testid="publish-changes-truncated"]')).toBeNull();
    const restore = [...host.querySelectorAll('button')].find((button) => button.textContent === 'publishes.restore');
    expect(restore).toBeDefined();
    await act(async () => restore?.click());
    expect(document.querySelector('[data-slot="action-dialog"]')?.textContent).toContain('deploy.rollback.confirmDesc(2)');
  });

  it('says how many changes the capped list leaves out', async () => {
    const changes = Array.from({ length: 200 }, (_, i) => ({
      id: `p${i}`,
      title: `P${i}`,
      path: `p${i}`,
      languageCode: 'en',
      kind: 'PAGE',
      status: 'added',
    }));
    mocks.detail.mockReturnValue(
      detail(item(2, 'READY'), { id: 'dep-2', version: 2 }, summary({ changes, totals: { added: 260, modified: 0, removed: 12 }, truncated: true })),
    );
    await showVersion('dep-2');
    expect(host.querySelectorAll('[data-change]')).toHaveLength(200);
    expect(host.querySelector('[data-testid="publish-changes-truncated"]')?.textContent).toBe('publishes.truncated(200|272)');
    expect(host.querySelector('[data-total="removed"]')?.textContent).toContain('12');
  });

  it('explains a version whose published copy is gone, and does not offer to restore it', async () => {
    mocks.detail.mockReturnValue(
      detail({ ...item(2, 'READY'), snapshotAvailable: false }, { id: 'dep-3', version: 3 }, { status: 'unavailable', reason: 'no_snapshot' }),
    );
    await showVersion('dep-2');
    expect(host.querySelector('[data-testid="publish-changes-unavailable"]')?.textContent).toBe('publishes.noSnapshot');
    expect(host.querySelector('[data-testid="publish-changes"]')).toBeNull();
    const restore = [...host.querySelectorAll('button')].find((button) => button.textContent === 'publishes.restore');
    expect(restore?.getAttribute('aria-disabled')).toBe('true');
    await act(async () => restore?.click());
    expect(document.querySelector('[data-slot="action-dialog"]')).toBeNull();
  });

  it('says a version is too large to compare, and still offers Restore', async () => {
    mocks.detail.mockReturnValue(detail(item(2, 'READY'), { id: 'dep-3', version: 3 }, { status: 'unavailable', reason: 'too_large' }));
    await showVersion('dep-2');
    expect(host.querySelector('[data-testid="publish-changes-unavailable"]')?.textContent).toBe('publishes.tooLarge');
    const restore = [...host.querySelectorAll('button')].find((button) => button.textContent === 'publishes.restore');
    expect(restore?.getAttribute('aria-disabled')).toBeNull();
  });

  it('never offers Restore on the live version', async () => {
    mocks.detail.mockReturnValue(detail(item(3, 'READY'), { id: 'dep-3', version: 3 }, summary()));
    await showVersion('dep-3');
    expect(host.querySelector('[data-slot="status-badge"][data-state="live"]')).not.toBeNull();
    expect([...host.querySelectorAll('button')].some((button) => button.textContent === 'publishes.restore')).toBe(false);
  });

  it('shows why a failed attempt failed and never offers to restore it', async () => {
    mocks.detail.mockReturnValue(
      detail(
        item(4, 'FAILED', {
          errorDetails: [{ type: 'broken-link', pageTitle: 'Guide', pagePath: 'guide', detail: 'Links to a missing page' }],
        }),
        { id: 'dep-3', version: 3 },
        null,
      ),
    );
    await showVersion('dep-4');
    expect(host.textContent).toContain('deploy.failedDetails');
    expect(host.textContent).toContain('Guide — Links to a missing page');
    expect(host.querySelector('[data-testid="publish-changes"]')).toBeNull();
    expect([...host.querySelectorAll('button')].some((button) => button.textContent === 'publishes.restore')).toBe(false);
  });

  it('disables Restore with the reason for someone without publish rights', async () => {
    mocks.edit.value = 'viewOnly';
    mocks.detail.mockReturnValue(detail(item(2, 'READY'), { id: 'dep-3', version: 3 }, summary()));
    await showVersion('dep-2');
    const restore = [...host.querySelectorAll('button')].find((button) => button.textContent === 'publishes.restore');
    expect(restore?.getAttribute('aria-disabled')).toBe('true');
    await act(async () => restore?.click());
    expect(document.querySelector('[data-slot="action-dialog"]')).toBeNull();
  });

  it('calls the first publish what it is: every page new, nothing to compare', async () => {
    mocks.detail.mockReturnValue(
      detail(item(1, 'READY'), { id: 'dep-1', version: 1 }, summary({ previous: null, totals: { added: 3, modified: 0, removed: 0 } })),
    );
    await showVersion('dep-1');
    expect(host.querySelector('h2')?.textContent).toBe('publish.firstPublish');
  });
});
