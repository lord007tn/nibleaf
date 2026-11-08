// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  confirm: vi.fn(),
  mutateAsync: vi.fn(),
  retry: vi.fn(),
  edit: 'edit' as 'edit' | 'viewOnly' | 'pending' | 'unknown',
}));
vi.mock('@/hooks/use-project-admin-status', () => ({ useProjectAdminStatus: () => ({ edit: state.edit, retry: state.retry, retrying: false }) }));
vi.mock('@nibleaf/design-system/components/ui/confirm', () => ({ useConfirm: () => state.confirm }));
vi.mock('@nibleaf/i18n/react', () => ({ useT: () => (key: string) => key }));
vi.mock('@/hooks/api', () => ({
  useLanguages: () => ({
    data: [
      { id: 'en', label: 'English', code: 'en', isDefault: true },
      { id: 'ar', label: 'العربية', code: 'ar', isDefault: false },
    ],
    isPending: false,
  }),
  useUpdateLanguage: () => ({ mutateAsync: state.mutateAsync, isPending: false }),
  useDeleteLanguage: () => ({ isPending: false }),
}));
vi.mock('@/components/editor/add-language-dialog', () => ({ AddLanguageDialog: () => null }));
vi.mock('./shared', () => ({ SectionHeader: () => null, sortLanguagesDefaultFirst: (rows: unknown) => rows }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { LanguagesSection } from './languages-section';

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
let root: ReturnType<typeof createRoot>;
afterEach(async () => {
  await act(async () => root?.unmount());
  document.body.replaceChildren();
  vi.clearAllMocks();
  state.edit = 'edit';
});

it('shows a Viewer the languages without any way to change them', async () => {
  state.edit = 'viewOnly';
  const host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root.render(<LanguagesSection project={{ id: 'site' } as never} />));
  const labels = [...host.querySelectorAll('button')].map((item) => item.textContent ?? '');
  expect(labels.some((label) => label.includes('settings.languages.makeDefault'))).toBe(false);
  expect(labels.some((label) => label.includes('settings.languages.add'))).toBe(false);
  expect(host.querySelector('[aria-label="settings.languages.delete"]')).toBeNull();
  for (const toggle of host.querySelectorAll('[role="switch"]'))
    expect(toggle.getAttribute('aria-disabled') ?? toggle.getAttribute('data-disabled')).not.toBeNull();
  expect(host.textContent).toContain('access.viewOnly.action');
});
it('keeps languages locked with a retry when the role could not be read', async () => {
  state.edit = 'unknown';
  const host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root.render(<LanguagesSection project={{ id: 'site' } as never} />));
  const labels = [...host.querySelectorAll('button')].map((item) => item.textContent ?? '');
  expect(labels.some((label) => label.includes('settings.languages.makeDefault'))).toBe(false);
  expect(host.textContent).not.toContain('access.viewOnly.action');
  const retry = host.querySelector<HTMLButtonElement>('[data-testid="access-unknown-banner"] button');
  await act(async () => retry?.click());
  expect(state.retry).toHaveBeenCalledOnce();
});
it.each([false, true])('changes the default language only after approval (%s)', async (approved) => {
  state.confirm.mockResolvedValue(approved);
  const host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root.render(<LanguagesSection project={{ id: 'site' } as never} />));
  const trigger = [...host.querySelectorAll('button')].find((item) => item.textContent === 'settings.languages.makeDefault');
  await act(async () => trigger?.click());
  expect(state.confirm).toHaveBeenCalledWith(expect.objectContaining({ description: 'settings.languages.defaultConfirm.description' }));
  expect(state.mutateAsync).toHaveBeenCalledTimes(approved ? 1 : 0);
  if (approved) expect(state.mutateAsync).toHaveBeenCalledWith({ id: 'ar', body: { isDefault: true } });
});
