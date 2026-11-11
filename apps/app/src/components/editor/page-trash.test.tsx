/** @vitest-environment jsdom */

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  t: vi.fn((key: string, vars?: Record<string, unknown>) => (vars ? `${key} ${JSON.stringify(vars)}` : key)),
  confirm: vi.fn(async () => true),
  deleteMutate: vi.fn(),
  restore: vi.fn(),
  purge: vi.fn(),
  trash: vi.fn(),
  count: vi.fn(),
  toast: { success: vi.fn(() => 'toast-1'), error: vi.fn(), dismiss: vi.fn() },
}));

vi.mock('@nibleaf/i18n/react', () => ({ useT: () => mocks.t, useLocale: () => ({ locale: 'en', t: mocks.t }) }));
vi.mock('@nibleaf/design-system/components/ui/confirm', () => ({ useConfirm: () => mocks.confirm }));
vi.mock('sonner', () => ({ toast: mocks.toast }));
vi.mock('@/hooks/api', () => ({
  friendlyErrorMessage: (_t: unknown, _error: unknown, key: string) => key,
  useDeletePage: () => ({ mutate: mocks.deleteMutate }),
}));
vi.mock('@/hooks/api/errors', () => ({ friendlyErrorMessage: (_t: unknown, _error: unknown, key: string) => key }));
vi.mock('@/hooks/api/page-trash', () => ({
  useRestorePageTrash: () => ({ mutateAsync: mocks.restore, isPending: false }),
  usePurgePageTrash: () => ({ mutateAsync: mocks.purge }),
  usePageTrash: mocks.trash,
  usePageTrashCount: mocks.count,
}));

import { PageTrashButton } from './page-trash-button';
import PageTrashDialog, { daysLeft } from './page-trash-dialog';
import { useDeletePageFlow } from './use-delete-page';

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);

const DAY = 24 * 60 * 60 * 1000;
const item = (overrides: Record<string, unknown> = {}) => ({
  id: 'trash-1',
  rootPageId: 'page-1',
  branchId: 'branch-1',
  languageId: 'lang-en',
  parentId: null,
  title: 'Setup',
  kind: 'PAGE',
  pageCount: 3,
  deletedAt: new Date(Date.now() - 60_000).toISOString(),
  expiresAt: new Date(Date.now() + 29.5 * DAY).toISOString(),
  deletedBy: { id: 'user-1', name: 'Ada', email: 'ada@example.invalid', image: null },
  ...overrides,
});

const roots: Array<ReturnType<typeof createRoot>> = [];
beforeEach(() => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe = vi.fn();
      unobserve = vi.fn();
      disconnect = vi.fn();
    },
  );
  mocks.trash.mockReturnValue({ isPending: false, isError: false, isFetching: false, data: [item()], refetch: vi.fn() });
  mocks.count.mockReturnValue({ data: { count: 2 } });
  mocks.restore.mockResolvedValue({ page: { id: 'page-1', path: 'setup' }, restoredPages: 3, slugChanged: false, movedToTopLevel: false });
  mocks.purge.mockResolvedValue({ id: 'trash-1' });
});
afterEach(async () => {
  for (const root of roots.splice(0)) await act(async () => root.unmount());
  document.body.replaceChildren();
  vi.clearAllMocks();
});

const mount = async (node: React.ReactNode) => {
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  await act(async () => root.render(node));
};
const button = (text: string) => {
  const found = [...document.querySelectorAll<HTMLElement>('button, [role="menuitem"]')].find((element) => element.textContent?.trim() === text);
  if (!found) throw new Error(`No button "${text}"`);
  return found;
};

describe('delete with Undo', () => {
  let flow: ReturnType<typeof useDeletePageFlow> | null = null;
  function Harness() {
    flow = useDeletePageFlow('project-1', [{ id: 'page-1', parentId: null, kind: 'PAGE', title: 'Setup' } as never]);
    return null;
  }

  it('says the page moves to Trash for 30 days, and Undo restores it through the same restore', async () => {
    await mount(<Harness />);
    mocks.deleteMutate.mockImplementation((_id: string, callbacks: { onSuccess: (data: unknown) => void }) =>
      callbacks.onSuccess({ id: 'page-1', trashId: 'trash-9', pageCount: 1, expiresAt: '' }),
    );
    await act(async () => flow?.({ id: 'page-1', kind: 'PAGE', title: 'Setup' }));
    expect(mocks.confirm).toHaveBeenCalledWith(expect.objectContaining({ description: 'editor.deletePageConfirm {"title":"Setup"}' }));
    expect(mocks.toast.success).toHaveBeenCalledWith(
      'editor.deleted {"title":"Setup"}',
      expect.objectContaining({ action: expect.objectContaining({ label: 'editor.toolbar.undo' }) }),
    );
    const [, options] = mocks.toast.success.mock.calls[0] as unknown as [string, { action: { onClick: () => void } }];
    await act(async () => options.action.onClick());
    expect(mocks.restore).toHaveBeenCalledWith('trash-9');
    expect(mocks.toast.success).toHaveBeenLastCalledWith('editor.trash.restored {"title":"Setup"}');
  });

  it('says where a restored page went when its address or group is gone', async () => {
    await mount(<Harness />);
    mocks.deleteMutate.mockImplementation((_id: string, callbacks: { onSuccess: (data: unknown) => void }) =>
      callbacks.onSuccess({ id: 'page-1', trashId: 'trash-9', pageCount: 1, expiresAt: '' }),
    );
    mocks.restore.mockResolvedValueOnce({ page: { id: 'page-1', path: 'setup-2' }, restoredPages: 1, slugChanged: true, movedToTopLevel: false });
    await act(async () => flow?.({ id: 'page-1', kind: 'PAGE', title: 'Setup' }));
    const [, options] = mocks.toast.success.mock.calls[0] as unknown as [string, { action: { onClick: () => void } }];
    await act(async () => options.action.onClick());
    expect(mocks.toast.success).toHaveBeenLastCalledWith('editor.trash.restoredAt {"title":"Setup","path":"setup-2"}');

    mocks.restore.mockRejectedValueOnce(new Error('gone'));
    await act(async () => options.action.onClick());
    expect(mocks.toast.error).toHaveBeenCalledWith('editor.trash.restoreFailed');
  });
});

describe('Trash dialog', () => {
  const props = { projectId: 'project-1', languages: [{ id: 'lang-en', label: 'English' }], open: true, onOpenChange: vi.fn() };

  it('lists the title, page count, who deleted it, when, and days left', async () => {
    await mount(<PageTrashDialog {...props} canEdit />);
    const row = document.querySelector('[data-testid="page-trash-item"]');
    expect(row?.textContent).toContain('Setup');
    expect(row?.textContent).toContain('dashboard.pages');
    expect(row?.textContent).toContain('editor.trash.deletedBy');
    expect(row?.textContent).toContain('"name":"Ada"');
    expect(row?.textContent).toContain('editor.trash.expires');
  });

  it('restores an item', async () => {
    await mount(<PageTrashDialog {...props} canEdit />);
    await act(async () => button('editor.trash.restore').click());
    expect(mocks.restore).toHaveBeenCalledWith('trash-1');
  });

  it('shows the empty state', async () => {
    mocks.trash.mockReturnValue({ isPending: false, isError: false, isFetching: false, data: [], refetch: vi.fn() });
    await mount(<PageTrashDialog {...props} canEdit />);
    expect(document.body.textContent).toContain('editor.trash.emptyTitle');
  });

  it('explains why a viewer cannot restore', async () => {
    await mount(<PageTrashDialog {...props} canEdit={false} />);
    const restore = button('editor.trash.restore');
    expect(restore.getAttribute('aria-disabled')).toBe('true');
    await act(async () => restore.click());
    expect(mocks.restore).not.toHaveBeenCalled();
  });
});

describe('Trash button', () => {
  it('shows the count from the read-only count query and loads the list only once opened', async () => {
    await mount(<PageTrashButton canEdit languages={[]} projectId="project-1" />);
    expect(mocks.count).toHaveBeenCalledWith('project-1', undefined);
    expect(document.querySelector('[data-testid="page-trash-button"]')?.textContent).toContain('editor.trash.button {"count":"2"}');
    // The dialog module (and its list query) is not loaded with the page tree.
    expect(mocks.trash).not.toHaveBeenCalled();
    await act(async () => (document.querySelector('[data-testid="page-trash-button"]') as HTMLElement).click());
    await vi.waitFor(() => expect(document.querySelector('[data-testid="page-trash-item"]')).not.toBeNull());
    expect(mocks.trash).toHaveBeenCalledWith('project-1', undefined, true);
  });
});

describe('daysLeft', () => {
  it('counts whole days and never goes below zero', () => {
    const now = Date.UTC(2026, 0, 1);
    expect(daysLeft(new Date(now + 30 * DAY).toISOString(), now)).toBe(30);
    expect(daysLeft(new Date(now + 1.5 * DAY).toISOString(), now)).toBe(1);
    expect(daysLeft(new Date(now + 1000).toISOString(), now)).toBe(0);
    expect(daysLeft(new Date(now - DAY).toISOString(), now)).toBe(0);
  });
});
