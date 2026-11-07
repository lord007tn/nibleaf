// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { beforeEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  markRead: vi.fn(),
  navigate: vi.fn(),
  role: 'admin',
  membersPending: false,
  membersError: false,
  detail: 'ProviderError: stack trace',
  lastProject: undefined as string | undefined,
}));
vi.mock('@nibleaf/i18n/react', () => ({ useT: () => (key: string) => key, useLocale: () => ({ t: (key: string) => key, locale: 'en' }) }));
vi.mock('@tanstack/react-router', () => ({ useNavigate: () => mocks.navigate }));
vi.mock('@/lib/format', () => ({ useFormatters: () => ({ relativeTime: () => 'recently' }) }));
vi.mock('@/components/query-error-state', () => ({ QueryErrorState: () => null }));
vi.mock('@/services/auth-client', () => ({ useSession: () => ({ data: { user: { id: 'user-1' } }, isPending: false }) }));
vi.mock('@/hooks/api', () => ({
  useProjectMembers: (projectId: string | undefined) => {
    mocks.lastProject = projectId;
    return { data: { members: [{ user: { id: 'user-1' }, role: mocks.role }] }, isPending: mocks.membersPending, isError: mocks.membersError };
  },
  useUnreadNotificationCount: () => ({ data: { count: 1 } }),
  useNotifications: () => ({
    data: {
      items: [
        {
          id: 'failed-1',
          type: 'deploy_failed',
          projectId: 'project-1',
          title: 'Raw title',
          body: 'Legacy text',
          params: { projectName: 'Fixture', details: mocks.detail },
          readAt: null,
          href: '/app/projects/project-1',
          createdAt: '2026-11-07T00:00:00Z',
        },
      ],
    },
    isPending: false,
  }),
  useMarkNotificationsRead: () => ({ mutate: mocks.markRead, isPending: false }),
}));

import { NotificationsPopover } from './notifications-popover';

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
beforeEach(() => {
  mocks.markRead.mockClear();
  mocks.navigate.mockClear();
  mocks.role = 'admin';
  mocks.membersPending = false;
  mocks.membersError = false;
  mocks.detail = 'ProviderError: stack trace';
  mocks.lastProject = undefined;
});
it('opens technical details without marking a notification read or navigating', async () => {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  try {
    await act(() => root.render(<NotificationsPopover />));
    await act(() => host.querySelector<HTMLButtonElement>('button')?.click());
    const summary = document.querySelector('summary');
    expect(summary?.textContent).toBe('failures.details');
    expect(summary?.closest('button')).toBeNull();
    await act(() => summary?.click());
    expect(document.querySelector('details')?.open).toBe(true);
    expect(mocks.markRead).not.toHaveBeenCalled();
    expect(mocks.navigate).not.toHaveBeenCalled();
    const row = [...document.querySelectorAll('button')].find((button) => button.textContent?.includes('notifications.deployFailed.namedTitle'));
    await act(() => row?.click());
    expect(mocks.markRead).toHaveBeenCalledWith({ ids: ['failed-1'] });
    expect(mocks.navigate).toHaveBeenCalledWith({ to: '/app/projects/project-1' });
  } finally {
    await act(() => root.unmount());
    host.remove();
  }
});

it.each(['admin', 'member', 'pending', 'error'])('uses the notification project role for redirect advice: %s', async (role) => {
  mocks.role = role === 'member' ? 'member' : 'admin';
  mocks.membersPending = role === 'pending';
  mocks.membersError = role === 'error';
  mocks.detail = 'Redirect cycle detected: /old /new';
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  try {
    await act(() => root.render(<NotificationsPopover />));
    await act(() => host.querySelector<HTMLButtonElement>('button')?.click());
    expect(mocks.lastProject).toBe('project-1');
    if (role === 'admin') {
      expect(document.body.textContent).toContain('failures.redirectsAdmin');
      expect(document.body.textContent).not.toContain('failures.redirectsEditor');
    } else if (role === 'member') {
      expect(document.body.textContent).toContain('failures.redirectsEditor');
      expect(document.body.textContent).not.toContain('failures.redirectsAdmin');
    } else {
      expect(document.body.textContent).toContain('failures.redirects');
      expect(document.body.textContent).not.toContain('failures.redirectsAdmin');
      expect(document.body.textContent).not.toContain('failures.redirectsEditor');
    }
  } finally {
    await act(() => root.unmount());
    host.remove();
  }
});
