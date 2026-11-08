// @vitest-environment jsdom

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MembersSection } from './members-section';

const translations: Record<string, string> = {
  'roles.owner': 'المالك',
  'roles.admin': 'مدير',
  'roles.editor': 'عضو',
  'roles.viewer': 'مشاهد',
  'settings.members.removeConfirm': 'Remove {name} from this site?',
  'settings.members.revokeConfirm': 'Revoke the invitation for {email}?',
};

const mutation = { isPending: false, mutate: vi.fn() };
/** Open one of the Members / Pending invites / Join links tabs. */
const openTab = async (key: string) => {
  const tab = [...document.querySelectorAll<HTMLElement>('[role="tab"]')].find((item) => item.textContent?.startsWith(key));
  await act(async () => tab?.click());
};
let currentUserId = 'u-owner';
const members = [
  { id: 'm-owner', role: 'owner', user: { id: 'u-owner', name: 'Owner', email: 'owner@example.com' } },
  { id: 'm-admin', role: 'admin', user: { id: 'u-admin', name: 'Admin', email: 'admin@example.com' } },
  { id: 'm-member', role: 'member', user: { id: 'u-member', name: 'Member', email: 'member@example.com' } },
  { id: 'm-viewer', role: 'viewer', user: { id: 'u-viewer', name: 'Viewer', email: 'viewer@example.com' } },
];

vi.mock('@nibleaf/i18n/react', () => ({
  useT: () => (key: string, variables?: Record<string, string>) => {
    let message = translations[key] ?? key;
    for (const [name, value] of Object.entries(variables ?? {})) message = message.replaceAll(`{${name}}`, value);
    return message;
  },
}));
vi.mock('@nibleaf/design-system/components/ui/confirm', () => ({ useConfirm: () => vi.fn(async () => false) }));
// Join links have their own tests; here only whether Admins get them matters.
vi.mock('./join-links-section', () => ({ JoinLinksSection: () => <div data-testid="join-links-stub" /> }));
vi.mock('@/services/auth-client', () => ({ useSession: () => ({ data: { user: { id: currentUserId } } }) }));
vi.mock('@/hooks/api', async () => ({
  friendlyErrorMessage: (await vi.importActual<typeof import('@/hooks/api/errors')>('@/hooks/api/errors')).friendlyErrorMessage,
  useProjectMembers: () => ({
    data: { members, invitations: [{ id: 'invite-a', email: 'invitee@example.com', role: 'member', expiresAt: '2030-01-01T00:00:00Z' }] },
    isPending: false,
  }),
  useInviteProjectMember: () => mutation,
  useRemoveProjectMember: () => mutation,
  useUpdateProjectMemberRole: () => mutation,
  useCancelProjectInvitation: () => mutation,
  useTransferProjectOwnership: () => mutation,
  useInviteSuggestions: () => ({ data: [] }),
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

    // Invite form (defaults to Editor), then the admin, editor and viewer rows —
    // the owner row is a badge, never a select.
    const triggerLabels = [...container.querySelectorAll('[data-slot="select-value"]')].map((node) => node.textContent);
    expect(triggerLabels).toEqual(['عضو', 'مدير', 'عضو', 'مشاهد']);
    for (const label of triggerLabels) {
      expect(label).not.toMatch(/^(admin|member|viewer)$/);
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
    expect(container.textContent).toContain('مشاهد');
    act(() => root.unmount());
  });

  it('shows a Viewer the team read-only', async () => {
    currentUserId = 'u-viewer';
    const root = createRoot(container);
    await act(async () => root.render(<MembersSection projectId="project-a" />));
    expect(container.querySelector('form')).toBeNull();
    expect(container.querySelector('[role="combobox"]')).toBeNull();
    expect(container.querySelector('[aria-label="settings.members.remove"]')).toBeNull();
    expect(container.textContent).toContain('مشاهد');
    expect(container.querySelector('[data-testid="join-links-stub"]')).toBeNull();
    act(() => root.unmount());
  });

  it('retains member administration for an admin without offering ownership transfer', async () => {
    currentUserId = 'u-admin';
    const root = createRoot(container);
    await act(async () => root.render(<MembersSection projectId="project-a" />));
    expect(container.querySelector('form')).not.toBeNull();
    // The email box (with suggestions), the invite role, and the three non-owner rows.
    expect(container.querySelectorAll('[role="combobox"]')).toHaveLength(5);
    expect(container.querySelector('[aria-label="settings.members.remove"]')).not.toBeNull();
    expect(container.querySelector('[aria-label="settings.members.transferOwnership"]')).toBeNull();
    await openTab('settings.members.tab.invites');
    expect(container.querySelector('[aria-label="settings.members.copyInviteLink"]')).not.toBeNull();
    await openTab('settings.joinLinks.title');
    expect(container.querySelector('[data-testid="join-links-stub"]')).not.toBeNull();
    act(() => root.unmount());
  });

  it.each([
    ['an editor', 'u-member'],
    ['an owner', 'u-owner'],
  ])('labels a role this version does not know as unknown for %s', async (_who, userId) => {
    currentUserId = userId;
    members.push({ id: 'm-odd', role: 'auditor', user: { id: 'u-odd', name: 'Odd', email: 'odd@example.com' } });
    try {
      const root = createRoot(container);
      await act(async () => root.render(<MembersSection projectId="project-a" />));
      // The odd member's row: the smallest block holding both their email and a role area.
      const row = [...container.querySelectorAll('.border-t')].find((node) => node.textContent?.includes('odd@example.com'));
      expect(row?.textContent).toContain('roles.unknown');
      expect(row?.textContent).not.toContain('مشاهد');
      act(() => root.unmount());
    } finally {
      members.pop();
    }
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
    [...document.querySelectorAll<HTMLButtonElement>('[role="alertdialog"] button')].find((button) => {
      const visible = button.cloneNode(true) as HTMLElement;
      for (const hidden of visible.querySelectorAll('[aria-hidden="true"]')) hidden.remove();
      return visible.textContent === label;
    });

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
    expect(document.querySelector('[role="alertdialog"] [role="alert"]')?.textContent).toBe('settings.members.toast.removeError');
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

  it('spins only the row whose removal is running', async () => {
    await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="settings.members.remove"]')?.click());
    await act(async () => dialogButton('settings.members.remove')?.click());

    const rowButtons = [
      ...container.querySelectorAll<HTMLButtonElement>('[aria-label="settings.members.remove"], [aria-label="settings.members.revokeInvite"]'),
    ];
    // Admin, editor and viewer rows (invitations live on their own tab).
    expect(rowButtons.map((button) => button.hasAttribute('data-loading'))).toEqual([true, false, false]);
    const settled = mutation.mutate.mock.calls[0]?.[1];
    await act(async () => {
      settled.onSuccess();
      settled.onSettled();
    });
  });

  it('copies an invite link without flashing a spinner', async () => {
    // The clipboard write is still in flight while the button is checked.
    const writeText = vi.fn(() => new Promise<void>(() => undefined));
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    await openTab('settings.members.tab.invites');
    const copy = container.querySelector<HTMLButtonElement>('[aria-label="settings.members.copyInviteLink"]');
    await act(async () => copy?.click());

    expect(writeText).toHaveBeenCalledOnce();
    expect(copy?.hasAttribute('data-loading')).toBe(false);
    expect(copy?.getAttribute('aria-busy')).not.toBe('true');
    Reflect.deleteProperty(navigator, 'clipboard');
  });

  it('requires an explicit action before revoking the named invitation', async () => {
    await openTab('settings.members.tab.invites');
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
