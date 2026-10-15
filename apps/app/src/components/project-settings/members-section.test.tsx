// @vitest-environment jsdom

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MembersSection } from './members-section';

const translations: Record<string, string> = {
  'settings.members.role.owner': 'المالك',
  'settings.members.role.admin': 'مدير',
  'settings.members.role.member': 'عضو',
  'settings.members.removeConfirm': 'Remove {name} from this site?',
  'settings.members.revokeConfirm': 'Revoke the invitation for {email}?',
};

const mutation = { isPending: false, mutate: vi.fn() };
let currentUserId = 'u-owner';
const members = [
  { id: 'm-owner', role: 'owner', user: { id: 'u-owner', name: 'Owner', email: 'owner@example.com' } },
  { id: 'm-admin', role: 'admin', user: { id: 'u-admin', name: 'Admin', email: 'admin@example.com' } },
  { id: 'm-member', role: 'member', user: { id: 'u-member', name: 'Member', email: 'member@example.com' } },
];

vi.mock('@nibleaf/i18n/react', () => ({
  useT: () => (key: string, variables?: Record<string, string>) => {
    let message = translations[key] ?? key;
    for (const [name, value] of Object.entries(variables ?? {})) message = message.replaceAll(`{${name}}`, value);
    return message;
  },
}));
vi.mock('@nibleaf/design-system/components/ui/confirm', () => ({ useConfirm: () => vi.fn(async () => false) }));
vi.mock('@/services/auth-client', () => ({ useSession: () => ({ data: { user: { id: currentUserId } } }) }));
vi.mock('@/hooks/api', () => ({
  useProjectMembers: () => ({
    data: { members, invitations: [{ id: 'invite-a', email: 'invitee@example.com', role: 'member', expiresAt: '2030-01-01T00:00:00Z' }] },
    isPending: false,
  }),
  useInviteProjectMember: () => mutation,
  useRemoveProjectMember: () => mutation,
  useUpdateProjectMemberRole: () => mutation,
  useCancelProjectInvitation: () => mutation,
  useTransferProjectOwnership: () => mutation,
}));

describe('MembersSection role selects', () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    currentUserId = 'u-owner';
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    container = document.createElement('div');
    container.dir = 'rtl';
    document.body.append(container);
  });

  afterEach(() => {
    container.remove();
    vi.clearAllMocks();
  });

  it('renders the translated role label in the trigger instead of the raw value', async () => {
    const root = createRoot(container);
    await act(async () => root.render(<MembersSection projectId="project-a" />));

    // Invite form (defaults to member), then the admin and member rows — the owner
    // row is a badge, never a select.
    const triggerLabels = [...container.querySelectorAll('[data-slot="select-value"]')].map((node) => node.textContent);
    expect(triggerLabels).toEqual(['عضو', 'مدير', 'عضو']);
    for (const label of triggerLabels) {
      expect(label).not.toMatch(/^(admin|member)$/);
    }

    act(() => root.unmount());
  });

  it('shows member roles without offering administration to an editor', async () => {
    currentUserId = 'u-member';
    const root = createRoot(container);
    await act(async () => root.render(<MembersSection projectId="project-a" />));
    expect(container.querySelector('form')).toBeNull();
    expect(container.querySelector('[role="combobox"]')).toBeNull();
    expect(container.querySelector('[aria-label="settings.members.remove"]')).toBeNull();
    expect(container.querySelector('[aria-label="settings.members.copyInviteLink"]')).toBeNull();
    expect(container.querySelector('[aria-label="settings.members.revokeInvite"]')).toBeNull();
    expect(container.textContent).toContain('مدير');
    expect(container.textContent).toContain('عضو');
    act(() => root.unmount());
  });

  it('retains member administration for an admin without offering ownership transfer', async () => {
    currentUserId = 'u-admin';
    const root = createRoot(container);
    await act(async () => root.render(<MembersSection projectId="project-a" />));
    expect(container.querySelector('form')).not.toBeNull();
    expect(container.querySelectorAll('[role="combobox"]')).toHaveLength(3);
    expect(container.querySelector('[aria-label="settings.members.remove"]')).not.toBeNull();
    expect(container.querySelector('[aria-label="settings.members.copyInviteLink"]')).not.toBeNull();
    expect(container.querySelector('[aria-label="settings.members.transferOwnership"]')).toBeNull();
    act(() => root.unmount());
  });

  it('fails closed while the current membership is unavailable', async () => {
    currentUserId = 'unknown';
    const root = createRoot(container);
    await act(async () => root.render(<MembersSection projectId="project-a" />));
    expect(container.querySelector('form')).toBeNull();
    expect(container.querySelector('[role="combobox"]')).toBeNull();
    act(() => root.unmount());
  });
});

describe('MembersSection destructive confirmations', () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;

  const dialogButton = (label: string) =>
    [...document.querySelectorAll<HTMLButtonElement>('[role="alertdialog"] button')].find((button) => button.textContent === label);

  beforeEach(async () => {
    currentUserId = 'u-owner';
    mutation.mutate.mockReset();
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    await act(async () => root.render(<MembersSection projectId="project-a" />));
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.clearAllMocks();
  });

  it('requires confirmation for removal and focuses Cancel without changing membership', async () => {
    await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="settings.members.remove"]')?.click());

    expect(document.querySelector('[role="alertdialog"]')?.textContent).toContain('Remove Admin from this site?');
    expect(document.activeElement).toBe(dialogButton('common.cancel'));
    expect(mutation.mutate).not.toHaveBeenCalled();
    await act(async () => dialogButton('common.cancel')?.click());
    expect(document.querySelector('[role="alertdialog"]')).toBeNull();
    expect(mutation.mutate).not.toHaveBeenCalled();
  });

  it('blocks duplicate removals while pending and keeps errors open for retry', async () => {
    await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="settings.members.remove"]')?.click());
    const confirm = dialogButton('settings.members.remove');
    await act(async () => {
      confirm?.click();
      confirm?.click();
    });

    expect(mutation.mutate).toHaveBeenCalledOnce();
    expect(mutation.mutate.mock.calls[0]?.[0]).toBe('m-admin');
    expect(dialogButton('common.loading')?.disabled).toBe(true);
    expect(dialogButton('common.cancel')?.disabled).toBe(true);
    await act(async () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
    expect(document.querySelector('[role="alertdialog"]')).not.toBeNull();

    const failed = mutation.mutate.mock.calls[0]?.[1];
    await act(async () => {
      failed.onError(new Error('Removal failed. Try again.'));
      failed.onSettled();
    });
    expect(document.querySelector('[role="alertdialog"] [role="alert"]')?.textContent).toBe('Removal failed. Try again.');
    expect(dialogButton('settings.members.remove')?.disabled).toBe(false);
    await act(async () => dialogButton('settings.members.remove')?.click());
    expect(mutation.mutate).toHaveBeenCalledTimes(2);
    const succeeded = mutation.mutate.mock.calls[1]?.[1];
    await act(async () => {
      succeeded.onSuccess();
      succeeded.onSettled();
    });
    expect(document.querySelector('[role="alertdialog"]')).toBeNull();
  });

  it('requires an explicit action before revoking the named invitation', async () => {
    await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="settings.members.revokeInvite"]')?.click());

    expect(document.querySelector('[role="alertdialog"]')?.textContent).toContain('invitee@example.com');
    expect(mutation.mutate).not.toHaveBeenCalled();
    await act(async () => dialogButton('settings.members.revokeInvite')?.click());
    expect(mutation.mutate).toHaveBeenCalledWith('invite-a', expect.any(Object));
    const succeeded = mutation.mutate.mock.calls[0]?.[1];
    await act(async () => {
      succeeded.onSuccess();
      succeeded.onSettled();
    });
    expect(document.querySelector('[role="alertdialog"]')).toBeNull();
  });
});
