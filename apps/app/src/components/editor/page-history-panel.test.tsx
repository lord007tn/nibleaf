/** @vitest-environment jsdom */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { computeAccessibleName, getRole } from 'dom-accessibility-api';
import { act, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Page } from '@/hooks/api/types';
import PageHistoryPanel from './page-history-panel';

const mocks = vi.hoisted(() => ({ restore: vi.fn(), compare: vi.fn(), history: vi.fn(), toast: vi.fn() }));
vi.mock('@nibleaf/i18n/react', () => ({ useLocale: () => ({ locale: 'en', t: (key: string) => key }) }));
vi.mock('sonner', () => ({ toast: { success: mocks.toast } }));
// Primitive interaction contracts have their own tests; these tests exercise
// the panel's data, selection, precondition and restore/editor handoff.
vi.mock('@nibleaf/design-system/components/ui/sheet', () => ({
  Sheet: ({ children }: { children: ReactNode }) => children,
  SheetContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  SheetHeader: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  SheetTitle: ({ children }: { children: ReactNode }) => <h2>{children}</h2>,
  SheetDescription: ({ children }: { children: ReactNode }) => <p>{children}</p>,
}));
vi.mock('@nibleaf/design-system/components/ui/action-dialog', () => ({
  ActionDialog: ({ open, onConfirm }: { open: boolean; onConfirm: () => Promise<void> }) =>
    open ? (
      <button type="button" onClick={() => void onConfirm()}>
        confirm
      </button>
    ) : null,
}));
vi.mock('@/hooks/api/page-history', () => ({
  pageHistoryQueryOptions: (_project: string, _page: string, source: string) => ({
    queryKey: ['history', source],
    initialPageParam: undefined,
    queryFn: mocks.history,
    getNextPageParam: () => undefined,
  }),
  pageHistoryComparisonQueryOptions: (_project: string, _page: string, entry: unknown) => ({
    queryKey: ['compare', entry],
    enabled: Boolean(entry),
    queryFn: mocks.compare,
  }),
  restorePageHistory: mocks.restore,
}));

describe('page history panel', () => {
  let root: ReturnType<typeof createRoot>;
  let host: HTMLDivElement;
  let qc: QueryClient;
  const page = { id: 'page', title: 'Current', content: 'Current body', updatedAt: '2026-11-11T08:00:00.000Z' } as Page;
  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    vi.clearAllMocks();
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
    qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    mocks.history.mockResolvedValue({
      entries: [
        {
          id: 'revision',
          source: 'revision',
          title: 'Saved',
          createdAt: '2026-11-10T08:00:00.000Z',
          contentBytes: 12,
          reason: 'autosave',
          author: 'Fictional editor',
          version: null,
        },
      ],
      next: null,
    });
    mocks.compare.mockResolvedValue({
      expectedUpdatedAt: '2026-11-11T09:00:00.000Z',
      title: { before: 'Saved', after: 'Current' },
      diff: {
        status: 'changed',
        lines: [
          { kind: 'removed', text: 'Old body' },
          { kind: 'added', text: 'Current body' },
        ],
      },
    });
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    qc.clear();
    host.remove();
  });
  const wait = async () => {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 30));
    });
  };
  const click = async (text: string) => {
    const button = [...host.querySelectorAll('button')].find((node) => node.textContent === text);
    if (!button) throw new Error(`Missing ${text}`);
    await act(async () => button.click());
    await wait();
  };
  const render = async (canRestore = true, onRestored = vi.fn()) => {
    await act(async () =>
      root.render(
        <QueryClientProvider client={qc}>
          <PageHistoryPanel projectId="project" page={page} canRestore={canRestore} onClose={vi.fn()} onRestored={onRestored} />
        </QueryClientProvider>,
      ),
    );
    await wait();
  };
  it('shows author, size and a server diff, then restores with the compared revision and hands the response to the editor', async () => {
    const onRestored = vi.fn();
    mocks.restore.mockResolvedValue({ ...page, title: 'Saved', content: 'Old body', updatedAt: '2026-11-11T09:01:00.000Z' });
    await render(true, onRestored);
    expect(host.textContent).toContain('Fictional editor');
    await click('editor.history.compare');
    expect(host.textContent).toContain('Old body');
    const getByRole = (role: string, name: string) =>
      [...host.querySelectorAll('[role]')].find((element) => getRole(element) === role && computeAccessibleName(element) === name);
    expect(getByRole('group', 'editor.history.removed')?.textContent).toContain('Old body');
    expect(getByRole('group', 'editor.history.added')?.textContent).toContain('Current body');
    await click('editor.history.restore');
    await click('confirm');
    expect(mocks.restore).toHaveBeenCalledExactlyOnceWith('project', 'page', { source: 'revision', entryId: 'revision' }, '2026-11-11T09:00:00.000Z');
    expect(onRestored).toHaveBeenCalledWith(expect.objectContaining({ content: 'Old body', title: 'Saved' }));
  });
  it('renders the capped comparison and explains why a viewer cannot restore', async () => {
    mocks.compare.mockResolvedValue({
      expectedUpdatedAt: page.updatedAt,
      title: { before: 'Saved', after: 'Current' },
      diff: { status: 'too-large', limit: 'bytes' },
    });
    await render(false);
    await click('editor.history.compare');
    expect(host.textContent).toContain('editor.history.tooLarge');
    const restore = [...host.querySelectorAll('button')].find((node) => node.textContent?.includes('editor.history.restore'));
    expect(restore?.getAttribute('aria-disabled') === 'true' || restore?.disabled).toBe(true);
    expect(host.textContent).toContain('editor.history.viewOnly');
    expect(mocks.restore).not.toHaveBeenCalled();
  });
  it('shows an empty state when history has no entries', async () => {
    mocks.history.mockResolvedValue({ entries: [], next: null });
    await render();
    expect(host.querySelector('[data-slot="empty-state"]')?.textContent).toContain('editor.history.empty');
  });
});
