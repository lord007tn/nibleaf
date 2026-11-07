// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ markRead: vi.fn(), navigate: vi.fn() }));
vi.mock('@nibleaf/i18n/react', () => ({ useT: () => (key: string) => key }));
vi.mock('@tanstack/react-router', () => ({ useNavigate: () => mocks.navigate }));
vi.mock('@/lib/format', () => ({ useFormatters: () => ({ relativeTime: () => 'recently' }) }));
vi.mock('@/components/query-error-state', () => ({ QueryErrorState: () => null }));
vi.mock('@/hooks/api', () => ({
  useUnreadNotificationCount: () => ({ data: { count: 1 } }),
  useNotifications: () => ({
    data: {
      items: [
        {
          id: 'failed-1',
          type: 'deploy_failed',
          title: 'Raw title',
          body: 'Legacy text',
          params: { projectName: 'Fixture', details: 'ProviderError: stack trace' },
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
