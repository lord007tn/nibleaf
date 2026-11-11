// @vitest-environment jsdom

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ navigate: vi.fn(), mutateAsync: vi.fn(), toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@nibleaf/i18n/react', () => ({
  useT: () => (key: string, vars?: Record<string, string>) => (vars ? `${key}:${Object.values(vars).join(',')}` : key),
}));
vi.mock('@tanstack/react-router', () => ({ useNavigate: () => mocks.navigate }));
vi.mock('sonner', () => ({ toast: mocks.toast }));
vi.mock('@/hooks/api', () => ({ useDeleteProject: () => ({ isPending: false, mutateAsync: mocks.mutateAsync }) }));
vi.mock('@/hooks/api/errors', () => ({ friendlyErrorMessage: (_t: unknown, _e: unknown, key: string) => key }));
vi.mock('@/lib/bidi', () => ({ isolate: (value: string) => value }));

import { DangerZone } from './danger-zone';

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
let root: ReturnType<typeof createRoot>;
const project = { id: 'site-1', name: 'API reference', organizationId: 'org-1' } as never;
const organization = { id: 'org-1', slug: 'acme', name: 'Acme Docs', logo: null, orgRole: 'admin', canCreateWebsite: true, websiteCount: 2 } as const;

beforeEach(() => {
  mocks.mutateAsync.mockResolvedValue(undefined);
});
afterEach(async () => {
  await act(async () => root?.unmount());
  document.body.replaceChildren();
  vi.clearAllMocks();
});

const render = async () => {
  const host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root.render(<DangerZone organization={organization} project={project} />));
  return host;
};
const dialog = () => document.querySelector<HTMLElement>('[data-slot="action-dialog"]');
const openDialog = async (host: HTMLElement) => act(async () => host.querySelector<HTMLButtonElement>('button')?.click());
const typeName = (value: string) =>
  act(async () => {
    const input = dialog()?.querySelector('input') as HTMLInputElement;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
const confirm = () => act(async () => [...(dialog()?.querySelectorAll('button') ?? [])].find((b) => b.type === 'submit')?.click());

it('says the website goes and the organization remains, with no ownership transfer here (AUTH-40)', async () => {
  const host = await render();
  expect(host.querySelector('h1')?.textContent).toBe('settings.danger.title');
  expect(host.textContent).toContain('settings.danger.delete.websiteDescription:Acme Docs');
  expect(host.textContent).not.toContain('settings.danger.transfer');
  expect(host.querySelector('[data-slot="settings-section"]')?.getAttribute('data-tone')).toBe('destructive');
});

it('deletes only after the exact website name, then returns to the organization Websites', async () => {
  const host = await render();
  await openDialog(host);
  expect(dialog()?.textContent).toContain('settings.danger.delete.typeToConfirm:API reference');
  await typeName('API');
  await confirm();
  expect(mocks.mutateAsync).not.toHaveBeenCalled();
  expect(dialog()?.textContent).toContain('settings.danger.delete.nameMismatch');
  await typeName('API reference');
  await confirm();
  expect(mocks.mutateAsync).toHaveBeenCalledWith('site-1');
  expect(mocks.toast.success).toHaveBeenCalledWith('settings.danger.delete.toast.deleted');
  expect(mocks.navigate).toHaveBeenCalledWith({ to: '/app/o/$orgSlug/websites', params: { orgSlug: 'acme' } });
});

it('keeps a failed deletion in the dialog, in plain words, without a toast', async () => {
  mocks.mutateAsync.mockRejectedValueOnce(new Error('PrismaClientKnownRequestError'));
  const host = await render();
  await openDialog(host);
  await typeName('API reference');
  await confirm();
  expect(dialog()?.querySelector('[data-slot="action-dialog-error"]')?.textContent).toBe('settings.danger.delete.toast.error');
  expect(mocks.toast.error).not.toHaveBeenCalled();
  expect(mocks.navigate).not.toHaveBeenCalled();
});

it('does nothing when cancelled', async () => {
  const host = await render();
  await openDialog(host);
  await act(async () => [...(dialog()?.querySelectorAll('button') ?? [])].find((b) => b.textContent === 'common.cancel')?.click());
  expect(mocks.mutateAsync).not.toHaveBeenCalled();
});
