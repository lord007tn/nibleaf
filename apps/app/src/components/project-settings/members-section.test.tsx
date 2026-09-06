// @vitest-environment jsdom

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MembersSection } from './members-section';

const translations: Record<string, string> = {
  'settings.members.role.owner': 'المالك',
  'settings.members.role.admin': 'مدير',
  'settings.members.role.member': 'عضو',
};

const mutation = { isPending: false, mutate: vi.fn() };
const members = [
  { id: 'm-owner', role: 'owner', user: { id: 'u-owner', name: 'Owner', email: 'owner@example.com' } },
  { id: 'm-admin', role: 'admin', user: { id: 'u-admin', name: 'Admin', email: 'admin@example.com' } },
  { id: 'm-member', role: 'member', user: { id: 'u-member', name: 'Member', email: 'member@example.com' } },
];

vi.mock('@nibleaf/i18n/react', () => ({ useT: () => (key: string) => translations[key] ?? key }));
vi.mock('@nibleaf/design-system/components/ui/confirm', () => ({ useConfirm: () => vi.fn(async () => false) }));
vi.mock('@/services/auth-client', () => ({ useSession: () => ({ data: { user: { id: 'u-owner' } } }) }));
vi.mock('@/hooks/api', () => ({
  useProjectMembers: () => ({ data: { members, invitations: [] }, isPending: false }),
  useInviteProjectMember: () => mutation,
  useRemoveProjectMember: () => mutation,
  useUpdateProjectMemberRole: () => mutation,
  useCancelProjectInvitation: () => mutation,
  useTransferProjectOwnership: () => mutation,
}));

describe('MembersSection role selects', () => {
  let container: HTMLDivElement;

  beforeEach(() => {
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
});
