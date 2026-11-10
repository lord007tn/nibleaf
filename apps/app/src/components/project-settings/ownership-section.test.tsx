// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ role: 'owner', admins: false }));
vi.mock('@nibleaf/i18n/react', () => ({ useT: () => (key: string) => key }));
vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => vi.fn(),
  Link: ({ children }: { children: import('react').ReactNode }) => <a href="/members">{children}</a>,
}));
vi.mock('@nibleaf/design-system/components/ui/confirm', () => ({ useConfirm: () => vi.fn(), usePrompt: () => vi.fn() }));
vi.mock('@/services/auth-client', () => ({ useSession: () => ({ data: { user: { id: 'owner' } } }) }));
vi.mock('@/hooks/api', () => ({
  useProjectMembers: () => ({
    data: {
      members: [
        { id: 'm1', role: state.role, user: { id: 'owner' } },
        ...(state.admins ? [{ id: 'm2', orgRole: 'admin', role: 'admin', user: { id: 'other', name: 'Other', email: 'other@example.test' } }] : []),
      ],
    },
  }),
  useDeleteProject: () => ({ isPending: false }),
  useTransferProjectOwnership: () => ({ isPending: false }),
}));

import { DangerSection } from './danger-section';

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
let root: ReturnType<typeof createRoot>;
afterEach(async () => {
  await act(async () => root?.unmount());
  document.body.replaceChildren();
});
it.each([false, true])('explains missing transfer recipients only when no Admin has joined (%s)', async (admins) => {
  state.admins = admins;
  state.role = 'owner';
  const host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root.render(<DangerSection project={{ id: 'site', name: 'Help' } as never} />));
  expect(host.textContent?.includes('settings.danger.transfer.noAdmins')).toBe(!admins);
  expect(host.querySelector('[aria-describedby="transfer-ownership-help"]') !== null).toBe(!admins);
  if (!admins) expect(host.querySelector('a')?.textContent).toBe('settings.members.title');
});
