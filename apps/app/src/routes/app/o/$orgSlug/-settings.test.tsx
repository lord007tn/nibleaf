// @vitest-environment jsdom
import { act, type ComponentType, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type OrgRole = 'owner' | 'admin' | 'member';
type Callbacks = { onSuccess?: (value?: unknown) => unknown; onError?: (error: unknown) => unknown };
type PromptOptions = { description: string; validate: (value: string) => string | undefined };

const mocks = vi.hoisted(() => ({
  orgRole: 'owner' as OrgRole,
  navigate: vi.fn(),
  fetchQuery: vi.fn(),
  confirm: vi.fn(),
  prompt: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
  update: vi.fn(),
  leave: vi.fn(),
  remove: vi.fn(),
  transfer: vi.fn(),
  members: [] as Array<{ id: string; orgRole: OrgRole; user: { name: string; email: string } }>,
  projects: [] as Array<{ id: string; name: string; _count?: { pages: number } }>,
}));

vi.mock('@nibleaf/i18n/react', () => ({
  useT: () => (key: string, vars?: Record<string, string>) => (vars ? `${key}(${Object.values(vars).join('|')})` : key),
}));
vi.mock('@nibleaf/i18n/locale-state', () => ({ getLocale: () => 'en', renderedLocale: () => 'en', subscribeLanguage: () => () => undefined }));
vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (options: Record<string, unknown>) => ({ options }),
  useNavigate: () => mocks.navigate,
}));
vi.mock('@tanstack/react-query', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tanstack/react-query')>()),
  useQueryClient: () => ({ fetchQuery: mocks.fetchQuery }),
}));
vi.mock('sonner', () => ({ toast: { success: mocks.toastSuccess, error: mocks.toastError } }));
vi.mock('@nibleaf/design-system/components/ui/confirm', () => ({ useConfirm: () => mocks.confirm, usePrompt: () => mocks.prompt }));
// A native select stands in for the Base UI one so options can be read without opening a popup.
vi.mock('@nibleaf/design-system/components/ui/select', () => ({
  Select: ({
    items,
    value,
    disabled,
    onValueChange,
  }: {
    items: Array<{ value: string; label: string }>;
    value: string;
    disabled?: boolean;
    onValueChange: (value: string | null) => void;
  }) => (
    <select data-testid="transfer-target" disabled={disabled} onChange={(event) => onValueChange(event.target.value)} value={value}>
      <option value="" />
      {items.map((item) => (
        <option key={item.value} value={item.value}>
          {item.label}
        </option>
      ))}
    </select>
  ),
  SelectContent: ({ children }: { children: ReactNode }) => children,
  SelectItem: ({ children }: { children: ReactNode }) => children,
  SelectTrigger: ({ children }: { children: ReactNode }) => children,
  SelectValue: () => null,
}));
vi.mock('@/components/organization/organization-context', () => ({
  useCurrentOrganization: () => ({
    id: 'org-1',
    slug: 'acme',
    name: 'Acme Docs',
    logo: null,
    orgRole: mocks.orgRole,
    canCreateWebsite: mocks.orgRole !== 'member',
    sendInvitationEmails: true,
  }),
  isOrgAdmin: (organization: { orgRole: OrgRole }) => organization.orgRole !== 'member',
}));
vi.mock('@/hooks/api', () => ({
  switcherQueryOptions: () => ({ queryKey: ['me', 'switcher'] }),
  useUpdateOrganization: () => ({ mutate: mocks.update, isPending: false }),
  useLeaveOrganization: () => ({ mutate: mocks.leave, isPending: false }),
  useDeleteOrganization: () => ({ mutate: mocks.remove, isPending: false }),
  useTransferOrganizationOwnership: () => ({ mutate: mocks.transfer, isPending: false }),
  useOrganizationMembers: () => ({ data: mocks.members, isPending: false }),
  useOrganizationProjects: () => ({ data: mocks.projects, isPending: false }),
}));

import { ApiResponseError } from '@/hooks/api/client-helpers';
import { Route } from './settings';

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
const SettingsPage = Route.options.component as unknown as ComponentType;
let root: ReturnType<typeof createRoot>;
const succeed =
  (value?: unknown) =>
  (_input: unknown, callbacks: Callbacks): unknown =>
    callbacks.onSuccess?.(value);

beforeEach(() => {
  mocks.orgRole = 'owner';
  mocks.members = [
    { id: 'm-owner', orgRole: 'owner', user: { name: 'Sara', email: 'sara@example.com' } },
    { id: 'm-admin', orgRole: 'admin', user: { name: 'Omar', email: 'omar@example.com' } },
    { id: 'm-member', orgRole: 'member', user: { name: 'Lina', email: 'lina@example.com' } },
  ];
  mocks.projects = [
    { id: 'p-1', name: 'Developer docs', _count: { pages: 10 } },
    { id: 'p-2', name: 'API reference', _count: { pages: 2 } },
  ];
  mocks.fetchQuery.mockResolvedValue({ organizations: [], recent: [], landing: { slug: 'jood' } });
  mocks.confirm.mockResolvedValue(true);
  mocks.leave.mockImplementation(succeed());
  mocks.remove.mockImplementation(succeed());
  mocks.transfer.mockImplementation(succeed());
});
afterEach(async () => {
  await act(async () => root?.unmount());
  document.body.replaceChildren();
  vi.clearAllMocks();
});

async function render() {
  const host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root.render(<SettingsPage />));
  return host;
}
const button = (host: HTMLElement, text: string) =>
  [...host.querySelectorAll<HTMLButtonElement>('button')].find((node) => node.textContent?.trim() === text) as HTMLButtonElement;
const click = (node: HTMLElement) => act(async () => node.click());
const flush = () => act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
const inputFor = (host: HTMLElement, label: string) => {
  const node = [...host.querySelectorAll('label')].find((candidate) => candidate.textContent === label);
  return document.getElementById(node?.htmlFor ?? '') as HTMLInputElement;
};
const type = (input: HTMLInputElement, value: string) =>
  act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });

describe('organization Settings: Member', () => {
  beforeEach(() => {
    mocks.orgRole = 'member';
  });

  it('shows only Leave organization', async () => {
    const host = await render();
    expect(host.textContent).not.toContain('organization.settings.general');
    expect(host.textContent).not.toContain('organization.settings.invitations');
    expect(host.textContent).not.toContain('organization.settings.transfer');
    expect(host.textContent).not.toContain('organization.settings.delete');
    expect(host.querySelector('[data-testid="transfer-target"]')).toBeNull();
    expect(button(host, 'organization.settings.leave')).toBeDefined();
  });

  it('leaving lands on the next org', async () => {
    const host = await render();
    await click(button(host, 'organization.settings.leave'));
    await flush();
    expect(mocks.confirm).toHaveBeenCalledWith(
      expect.objectContaining({ description: 'organization.settings.leaveConfirm(Acme Docs)', destructive: true }),
    );
    expect(mocks.leave).toHaveBeenCalledOnce();
    expect(mocks.toastSuccess).toHaveBeenCalledWith('organization.settings.left(Acme Docs)');
    expect(mocks.fetchQuery).toHaveBeenCalledWith(expect.objectContaining({ queryKey: ['me', 'switcher'], staleTime: 0 }));
    expect(mocks.navigate).toHaveBeenCalledWith({ to: '/app/o/$orgSlug/websites', params: { orgSlug: 'jood' }, replace: true });
  });

  it('leaving the last org lands on welcome with reason=left (also when the refetch fails)', async () => {
    mocks.fetchQuery.mockResolvedValue({ organizations: [], recent: [], landing: null });
    const host = await render();
    await click(button(host, 'organization.settings.leave'));
    await flush();
    expect(mocks.navigate).toHaveBeenCalledWith({ to: '/app/welcome', search: { reason: 'left' }, replace: true });
    mocks.navigate.mockClear();
    mocks.fetchQuery.mockRejectedValue(new Error('offline'));
    await click(button(host, 'organization.settings.leave'));
    await flush();
    expect(mocks.navigate).toHaveBeenCalledWith({ to: '/app/welcome', search: { reason: 'left' }, replace: true });
  });

  it('cancelling the confirmation does not leave', async () => {
    mocks.confirm.mockResolvedValue(false);
    const host = await render();
    await click(button(host, 'organization.settings.leave'));
    await flush();
    expect(mocks.leave).not.toHaveBeenCalled();
    expect(mocks.navigate).not.toHaveBeenCalled();
  });
});

describe('organization Settings: Admin', () => {
  it('sees General, Invitations and Leave, but no transfer or delete', async () => {
    mocks.orgRole = 'admin';
    const host = await render();
    expect(host.textContent).toContain('organization.settings.general');
    expect(host.textContent).toContain('organization.settings.invitations');
    expect(button(host, 'organization.settings.leave')).toBeDefined();
    expect(host.querySelector('[data-testid="transfer-target"]')).toBeNull();
    expect(button(host, 'organization.settings.delete')).toBeUndefined();
  });
});

describe('organization Settings: Owner', () => {
  it('has transfer and delete but no Leave', async () => {
    const host = await render();
    expect(host.textContent).toContain('organization.settings.general');
    expect(host.textContent).toContain('organization.settings.ownerCannotLeave');
    expect(button(host, 'organization.settings.leave')).toBeUndefined();
    expect(button(host, 'organization.settings.delete')).toBeDefined();
  });

  it('offers only org Admins as transfer targets and confirms with the org name', async () => {
    const host = await render();
    const select = host.querySelector<HTMLSelectElement>('[data-testid="transfer-target"]') as HTMLSelectElement;
    expect([...select.options].map((option) => option.value).filter(Boolean)).toEqual(['m-admin']);
    expect(select.options[1]?.textContent).toBe('Omar · omar@example.com');
    const transfer = button(host, 'settings.danger.transfer.button');
    expect(transfer.disabled).toBe(true);
    await act(async () => {
      select.value = 'm-admin';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(transfer.disabled).toBe(false);
    mocks.prompt.mockResolvedValue('Acme');
    await click(transfer);
    await flush();
    const [options] = mocks.prompt.mock.calls[0] as [PromptOptions];
    expect(options.description).toBe('organization.settings.transferConfirm(Omar|Acme Docs)');
    expect(options.validate('Acme')).toBe('organization.settings.nameMismatch');
    expect(options.validate('Acme Docs')).toBeUndefined();
    expect(mocks.transfer).not.toHaveBeenCalled();
    mocks.prompt.mockResolvedValue('Acme Docs');
    await click(transfer);
    await flush();
    expect(mocks.transfer).toHaveBeenCalledWith('m-admin', expect.anything());
    expect(mocks.toastSuccess).toHaveBeenCalledWith('settings.danger.transfer.toast.transferred');
  });

  it('explains there is nobody to transfer to without Admins', async () => {
    mocks.members = mocks.members.filter((member) => member.orgRole !== 'admin');
    const host = await render();
    expect(host.querySelector<HTMLSelectElement>('[data-testid="transfer-target"]')?.disabled).toBe(true);
    expect(host.textContent).toContain('organization.settings.transferNoAdmins');
  });

  it('delete lists the websites, requires the exact org name, then goes home', async () => {
    const host = await render();
    const summary = host.querySelector('[data-slot="delete-summary"]')?.textContent;
    expect(summary).toContain('Developer docs, API reference');
    expect(summary).toContain('organization.members.websites(2|other)');
    expect(summary).toContain('dashboard.pages(12|other)');
    mocks.prompt.mockResolvedValue('acme docs');
    await click(button(host, 'organization.settings.delete'));
    await flush();
    const [options] = mocks.prompt.mock.calls[0] as [PromptOptions];
    expect(options.description).toBe(summary);
    expect(options.validate('acme docs')).toBe('organization.settings.nameMismatch');
    expect(options.validate('Acme Docs')).toBeUndefined();
    expect(mocks.remove).not.toHaveBeenCalled();
    mocks.fetchQuery.mockResolvedValue({ organizations: [], recent: [], landing: null });
    mocks.prompt.mockResolvedValue('Acme Docs');
    await click(button(host, 'organization.settings.delete'));
    await flush();
    expect(mocks.remove).toHaveBeenCalledWith('Acme Docs', expect.anything());
    expect(mocks.toastSuccess).toHaveBeenCalledWith('organization.settings.deleted(Acme Docs)');
    expect(mocks.navigate).toHaveBeenCalledWith({ to: '/app/welcome', search: { reason: 'left' }, replace: true });
  });

  it('delete of an empty org says it is empty', async () => {
    mocks.projects = [];
    const host = await render();
    expect(host.querySelector('[data-slot="delete-summary"]')).toBeNull();
    mocks.prompt.mockResolvedValue(null);
    await click(button(host, 'organization.settings.delete'));
    await flush();
    const [options] = mocks.prompt.mock.calls[0] as [PromptOptions];
    expect(options.description).toBe('organization.settings.deleteEmpty');
  });
});

describe('organization Settings: General', () => {
  it('rejects an invalid handle', async () => {
    const host = await render();
    const save = button(host, 'common.save');
    expect(save.disabled).toBe(true);
    const handle = inputFor(host, 'organization.settings.handle');
    expect(handle.value).toBe('acme');
    await type(handle, 'Bad Handle');
    expect(handle.value).toBe('bad handle');
    expect(handle.getAttribute('aria-invalid')).toBe('true');
    expect(host.textContent).toContain('organization.settings.handleInvalid');
    expect(save.disabled).toBe(true);
    await type(handle, 'ab');
    expect(host.textContent).toContain('organization.settings.handleInvalid');
    await type(handle, 'acme--docs');
    expect(host.textContent).toContain('organization.settings.handleInvalid');
    await type(handle, 'acme-docs');
    expect(host.textContent).not.toContain('organization.settings.handleInvalid');
    expect(handle.getAttribute('aria-invalid')).toBe('false');
    expect(save.disabled).toBe(false);
  });

  it('saving a new handle sends only the handle and moves to the new slug', async () => {
    mocks.update.mockImplementation(succeed({ id: 'org-1', slug: 'acme-docs', name: 'Acme Docs' }));
    const host = await render();
    await type(inputFor(host, 'organization.settings.handle'), 'acme-docs');
    await click(button(host, 'common.save'));
    expect(mocks.update).toHaveBeenCalledWith({ slug: 'acme-docs' }, expect.anything());
    expect(mocks.toastSuccess).toHaveBeenCalledWith('organization.settings.saved');
    expect(mocks.navigate).toHaveBeenCalledWith({ to: '/app/o/$orgSlug/settings', params: { orgSlug: 'acme-docs' }, replace: true });
  });

  it('a rename keeps the slug, and a taken handle says so', async () => {
    mocks.update.mockImplementation(succeed({ id: 'org-1', slug: 'acme', name: 'Acme' }));
    const host = await render();
    await type(inputFor(host, 'organization.settings.name'), '  Acme  ');
    await click(button(host, 'common.save'));
    expect(mocks.update).toHaveBeenCalledWith({ name: 'Acme' }, expect.anything());
    expect(mocks.navigate).not.toHaveBeenCalled();
    mocks.update.mockImplementation((_input: unknown, callbacks: Callbacks) => callbacks.onError?.(new ApiResponseError('taken', 409)));
    await type(inputFor(host, 'organization.settings.handle'), 'taken-handle');
    await click(button(host, 'common.save'));
    expect(mocks.toastError).toHaveBeenCalledWith('organization.settings.handleTaken');
  });
});
