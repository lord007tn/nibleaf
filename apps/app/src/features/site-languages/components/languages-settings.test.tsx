// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Project } from '@/hooks/api';
import { LanguagesSettings } from './languages-settings';

const mocks = vi.hoisted(() => ({
  update: vi.fn(),
  remove: vi.fn(),
  retry: vi.fn(),
  refetch: vi.fn(),
  edit: 'edit' as 'edit' | 'viewOnly' | 'pending' | 'unknown',
  query: {} as { data?: unknown[]; isPending: boolean; isError: boolean; isFetching: boolean },
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));
vi.mock('@nibleaf/i18n/react', () => ({ useT: () => (key: string) => key, translateFn: (key: string) => key }));
vi.mock('@/hooks/use-project-admin-status', () => ({
  useProjectAdminStatus: () => ({ edit: mocks.edit, retry: mocks.retry, retrying: false }),
}));
vi.mock('@/hooks/api', () => ({
  useLanguages: () => ({ ...mocks.query, refetch: mocks.refetch }),
  useUpdateLanguage: () => ({ mutateAsync: mocks.update, isPending: false }),
  useDeleteLanguage: () => ({ mutateAsync: mocks.remove, isPending: false }),
}));
vi.mock('@/hooks/api/errors', () => ({ friendlyErrorMessage: (_t: unknown, _error: unknown, fallback: string) => `friendly:${fallback}` }));
vi.mock('@/components/editor/add-language-dialog', () => ({
  AddLanguageDialog: ({ open }: { open: boolean }) => (open ? <div data-testid="add-language-dialog" /> : null),
}));
vi.mock('sonner', () => ({ toast: { success: mocks.toastSuccess, error: mocks.toastError } }));
vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);

const english = {
  id: 'en',
  code: 'en',
  label: 'English',
  isDefault: true,
  enabled: true,
  direction: 'LTR',
  position: 0,
  coverage: { pageCount: 10, sourcePageCount: 10, matchedPages: 10, missingPages: 0, extraPages: 0, percentage: 100 },
};
const arabic = {
  id: 'ar',
  code: 'ar',
  label: 'العربية',
  isDefault: false,
  enabled: false,
  direction: 'RTL',
  position: 1,
  coverage: { pageCount: 4, sourcePageCount: 10, matchedPages: 4, missingPages: 6, extraPages: 0, percentage: 40 },
};

const project = { id: 'site' } as Project;
let root: ReturnType<typeof createRoot>;
let container: HTMLDivElement;

async function render() {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root.render(<LanguagesSettings project={project} />));
}

beforeEach(() => {
  mocks.edit = 'edit';
  // Arabic first: the screen orders the default language first itself.
  mocks.query = { data: [arabic, english], isPending: false, isError: false, isFetching: false };
});
afterEach(async () => {
  await act(async () => root?.unmount());
  document.body.replaceChildren();
  vi.clearAllMocks();
});

const buttons = () => [...document.querySelectorAll('button')];
const button = (name: string) => buttons().find((el) => (el.getAttribute('aria-label') ?? el.textContent) === name);
const rowsShown = () => [...container.querySelectorAll('[data-slot="data-list-item"]')].map((row) => row.getAttribute('data-language-id'));
const rowOf = (id: string) => container.querySelector(`[data-language-id="${id}"]`) as HTMLElement;
/** A menu item by its action text (the reason, when there is one, is a second line). */
const menuItem = (name: string) =>
  [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find((item) => item.querySelector('span > span')?.textContent === name);
/** Opens a row's actions menu. */
async function openActions(id: string) {
  const trigger = rowOf(id).querySelector<HTMLButtonElement>('[aria-label="settings.languages.actionsFor"]');
  if (!trigger) throw new Error(`No actions for ${id}`);
  await act(async () => trigger.click());
}
const dialog = () => document.querySelector('[data-slot="action-dialog"]');
const dialogButton = (name: string) => [...(dialog()?.querySelectorAll('button') ?? [])].find((el) => el.textContent === name);

describe('LanguagesSettings', () => {
  it('lists the default language first, each label in its own direction, with StatusBadges', async () => {
    await render();
    expect(container.querySelector('h1')?.textContent).toBe('settings.languages');
    expect(container.textContent).not.toContain('◫');
    expect(rowsShown()).toEqual(['en', 'ar']);
    const arabicTitle = rowOf('ar').querySelector('[data-slot="data-list-item-title"] span') as HTMLElement;
    expect(arabicTitle.dir).toBe('rtl');
    expect(arabicTitle.lang).toBe('ar');
    const badges = (id: string) => [...rowOf(id).querySelectorAll('[data-slot="status-badge"]')].map((badge) => badge.textContent);
    expect(badges('en')).toEqual(['settings.languages.defaultBadge']);
    expect(badges('ar')).toEqual(['settings.languages.hiddenBadge', 'settings.languages.coverage.percent']);
    expect(rowOf('ar').textContent).toContain('settings.languages.coverage.summary');
    expect(rowOf('ar').textContent).toContain('settings.languages.coverage.missing');
    expect(rowOf('en').textContent).toContain('settings.languages.coverage.sourcePages');
  });

  it('shows a Viewer the languages without any way to change them, and says why once', async () => {
    mocks.edit = 'viewOnly';
    await render();
    expect(rowsShown()).toEqual(['en', 'ar']);
    expect(button('settings.languages.actionsFor')).toBeUndefined();
    expect(buttons().some((el) => el.textContent?.includes('settings.languages.add'))).toBe(false);
    expect(container.querySelectorAll('[data-slot="callout"]')).toHaveLength(1);
    expect(container.textContent).toContain('access.viewOnly.action');
  });

  it('keeps languages locked with a retry when the role could not be read', async () => {
    mocks.edit = 'unknown';
    await render();
    expect(container.textContent).not.toContain('access.viewOnly.action');
    expect(buttons().find((el) => el.textContent?.includes('settings.languages.add'))?.disabled).toBe(true);
    await openActions('ar');
    const makeDefault = menuItem('settings.languages.makeDefault');
    expect(makeDefault?.getAttribute('aria-disabled')).toBe('true');
    // Locked, not explained: unknown access is not a reason.
    expect(makeDefault?.querySelector('[data-slot="row-actions-item-reason"]')).toBeNull();
    const retry = container.querySelector<HTMLButtonElement>('[data-testid="access-unknown-callout"] button');
    await act(async () => retry?.click());
    expect(mocks.retry).toHaveBeenCalledOnce();
  });

  it('opens the existing Add language dialog', async () => {
    await render();
    const add = buttons().find((el) => el.textContent?.includes('settings.languages.add'));
    await act(async () => add?.click());
    expect(document.querySelector('[data-testid="add-language-dialog"]')).not.toBeNull();
  });

  it('names each row’s actions and explains why the default language’s are unavailable', async () => {
    await render();
    await openActions('en');
    const reason = (name: string) => menuItem(name)?.querySelector('[data-slot="row-actions-item-reason"]')?.textContent;
    expect(reason('settings.languages.makeDefault')).toBe('settings.languages.reason.alreadyDefault');
    expect(reason('settings.languages.hide')).toBe('settings.languages.hint');
    expect(reason('settings.languages.delete')).toBe('settings.languages.reason.defaultCantBeDeleted');
  });

  it.each([false, true])('changes the default language only after approval (approved: %s)', async (approved) => {
    mocks.update.mockResolvedValue(undefined);
    await render();
    await openActions('ar');
    await act(async () => menuItem('settings.languages.makeDefault')?.click());
    expect(dialog()?.textContent).toContain('settings.languages.defaultConfirm.description');
    expect(mocks.update).not.toHaveBeenCalled();
    await act(async () => dialogButton(approved ? 'settings.languages.makeDefault' : 'common.cancel')?.click());
    expect(mocks.update).toHaveBeenCalledTimes(approved ? 1 : 0);
    if (approved) {
      expect(mocks.update).toHaveBeenCalledWith({ id: 'ar', body: { isDefault: true } });
      expect(mocks.toastSuccess).toHaveBeenCalledWith('common.saved');
    }
  });

  it('shows a hidden language again from its row menu', async () => {
    mocks.update.mockResolvedValue(undefined);
    await render();
    await openActions('ar');
    await act(async () => menuItem('settings.languages.show')?.click());
    expect(mocks.update).toHaveBeenCalledWith({ id: 'ar', body: { enabled: true } });
    expect(mocks.toastSuccess).toHaveBeenCalledWith('common.saved');
  });

  it('toasts a friendly message when showing or hiding fails', async () => {
    mocks.update.mockRejectedValue(new Error('boom'));
    await render();
    await openActions('ar');
    await act(async () => menuItem('settings.languages.show')?.click());
    expect(mocks.toastError).toHaveBeenCalledWith('friendly:settings.saveError');
  });

  it('deletes a language through a destructive dialog that keeps the error inside it', async () => {
    mocks.remove.mockRejectedValueOnce(new Error('boom')).mockResolvedValueOnce(undefined);
    await render();
    await openActions('ar');
    await act(async () => menuItem('settings.languages.delete')?.click());
    expect(dialog()?.textContent).toContain('settings.languages.deleteConfirm.title');
    await act(async () => dialogButton('settings.languages.delete')?.click());
    expect(mocks.remove).toHaveBeenCalledWith('ar');
    expect(document.querySelector('[data-slot="action-dialog-error"]')?.textContent).toBe('friendly:settings.languages.deleteError');
    await act(async () => dialogButton('settings.languages.delete')?.click());
    expect(mocks.remove).toHaveBeenCalledTimes(2);
    expect(mocks.toastSuccess).toHaveBeenCalledWith('settings.languages.deleted');
  });

  it('offers a retry when the languages fail to load', async () => {
    mocks.query = { data: undefined, isPending: false, isError: true, isFetching: false };
    await render();
    expect(container.querySelector('[data-slot="data-list"]')).toBeNull();
    await act(async () => button('error.tryAgain')?.click());
    expect(mocks.refetch).toHaveBeenCalledOnce();
  });

  it('shows placeholder rows while the languages load', async () => {
    mocks.query = { data: undefined, isPending: true, isError: false, isFetching: true };
    await render();
    expect(container.querySelector('[data-slot="data-list-skeleton"]')).not.toBeNull();
  });
});
