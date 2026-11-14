// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NotificationItem } from '@/hooks/api/types';

const mocks = vi.hoisted(() => ({
  markRead: vi.fn(),
  navigate: vi.fn(),
  role: 'admin',
  membersPending: false,
  membersError: false,
  membersMissing: false,
  detail: 'ProviderError: stack trace',
  lastProject: undefined as string | undefined,
  requestedProjects: [] as string[],
  items: undefined as NotificationItem[] | undefined,
  count: 1,
  translations: {} as Record<string, string>,
  organizationId: undefined as string | undefined,
  notificationOptions: [] as Array<{ enabled: boolean; organizationId?: string }>,
}));
vi.mock('@nibleaf/i18n/react', () => ({
  useT: () => (key: string, vars?: { count: string }) => (vars ? `${key}: ${vars.count}` : (mocks.translations[key] ?? key)),
  useLocale: () => ({ t: (key: string) => key, locale: 'en' }),
}));
vi.mock('@tanstack/react-router', () => ({ useNavigate: () => mocks.navigate }));
vi.mock('./org-switcher/switcher-context', () => ({ useSwitcherControls: () => ({ current: { organizationId: mocks.organizationId } }) }));
vi.mock('@/lib/format', () => ({
  useFormatters: () => ({ relativeTime: () => 'recently', number: (count: number) => count.toLocaleString('en-US') }),
}));
vi.mock('@/components/query-error-state', () => ({ QueryErrorState: () => null }));
vi.mock('@/services/auth-client', () => ({ useSession: () => ({ data: { user: { id: 'user-1' } }, isPending: false }) }));
vi.mock('@/hooks/api', () => ({
  useProjectMembers: (projectId: string | undefined) => {
    mocks.lastProject = projectId;
    if (projectId) mocks.requestedProjects.push(projectId);
    return {
      data: mocks.membersMissing ? undefined : { members: [{ user: { id: 'user-1' }, role: mocks.role }] },
      isPending: mocks.membersPending,
      isError: mocks.membersError,
    };
  },
  useUnreadNotificationCount: () => ({ data: { count: mocks.count } }),
  useNotifications: (options: { enabled: boolean; organizationId?: string }) => {
    mocks.notificationOptions.push(options);
    return {
      data: {
        items: mocks.items ?? [
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
    };
  },
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
  mocks.membersMissing = false;
  mocks.detail = 'ProviderError: stack trace';
  mocks.lastProject = undefined;
  mocks.requestedProjects = [];
  mocks.items = undefined;
  mocks.count = 1;
  mocks.translations = {};
  mocks.organizationId = undefined;
  mocks.notificationOptions = [];
});

it('allows the long German header action and title to shrink and wrap', async () => {
  mocks.translations = { 'notifications.title': 'Benachrichtigungen', 'notifications.markAllRead': 'Alles als gelesen markieren' };
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  try {
    await act(() => root.render(<NotificationsPopover />));
    await act(() => host.querySelector<HTMLButtonElement>('button')?.click());
    const action = [...document.querySelectorAll('button')].find((button) => button.textContent?.includes('Alles als gelesen markieren'));
    expect(action).toBeDefined();
    for (const token of ['h-auto', 'min-w-0', 'max-w-full', 'shrink', '[overflow-wrap:anywhere]'])
      expect(action?.classList.contains(token)).toBe(true);
    expect(action?.classList.contains('h-7')).toBe(false);
    const title = [...document.querySelectorAll('span')].find((span) => span.textContent === 'Benachrichtigungen');
    expect(title?.classList.contains('[overflow-wrap:anywhere]')).toBe(true);
    // P2-DASH-010: the popover is named by its title.
    expect(document.querySelector('[data-slot="popover-content"]')?.getAttribute('aria-labelledby')).toBe(title?.id);
  } finally {
    await act(() => root.unmount());
    host.remove();
  }
});

it.each([
  { count: 0, label: 'notifications.bellLabel' },
  { count: 1, label: 'notifications.bellUnreadLabel: 1' },
  { count: 12, label: 'notifications.bellUnreadLabel: 12' },
  { count: 1234, label: 'notifications.bellUnreadLabel: 1,234' },
])('uses the expected bell name for unread count $count and exposes row unread state', async ({ count, label }) => {
  mocks.count = count;
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  try {
    await act(() => root.render(<NotificationsPopover />));
    const bell = host.querySelector<HTMLButtonElement>('button');
    expect(bell?.getAttribute('aria-label')).toBe(label);
    expect(bell?.querySelector('span')?.getAttribute('aria-hidden')).toBe(count > 0 ? 'true' : undefined);
    await act(() => bell?.click());
    expect(document.querySelector('[data-slot="popover-content"] .sr-only')?.textContent).toContain('notifications.unread');
    mocks.count = 0;
    mocks.items = [
      {
        id: 'read',
        type: 'deploy_ready',
        projectId: null,
        title: 'Read',
        body: '',
        params: null,
        href: null,
        readAt: '2026-11-08',
        createdAt: '2026-11-07',
      },
    ];
    await act(() => root.render(<NotificationsPopover />));
    expect(bell?.getAttribute('aria-label')).toBe('notifications.bellLabel');
    expect(bell?.querySelector('span')).toBeNull();
    expect(document.querySelector('[data-slot="popover-content"]')?.textContent).not.toContain('notifications.unread');
  } finally {
    await act(() => root.unmount());
    host.remove();
  }
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

it.each(['admin', 'member', 'pending', 'error', 'cached-error'])('uses the notification project role for redirect advice: %s', async (role) => {
  mocks.role = role === 'member' ? 'member' : 'admin';
  mocks.membersPending = role === 'pending';
  mocks.membersError = role === 'error' || role === 'cached-error';
  mocks.membersMissing = role === 'error';
  mocks.detail = 'Redirect cycle detected: /old /new';
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  try {
    await act(() => root.render(<NotificationsPopover />));
    await act(() => host.querySelector<HTMLButtonElement>('button')?.click());
    expect(mocks.lastProject).toBe('project-1');
    if (role === 'admin' || role === 'cached-error') {
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

it.each([false, true])('only enables member lookups for publish redirect failures (redirect present: %s)', async (withRedirect) => {
  const row = (projectId: string, detail: string, type = 'deploy_failed'): NotificationItem => ({
    id: projectId,
    projectId,
    type,
    title: 'Fixture',
    body: detail,
    params: null,
    href: null,
    readAt: null,
    createdAt: '2026-11-07T00:00:00Z',
  });
  mocks.items = Array.from({ length: 5 }, (_, index) => row(`old-site-${index}`, 'ProviderError: fetch failed'));
  mocks.items.push(row('export-site', 'Redirect failed', 'export_failed'), row('ready-site', 'Redirect failed', 'deploy_ready'));
  if (withRedirect) mocks.items.push(row('redirect-site', 'Redirect cycle detected: /old /new'));
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  try {
    await act(() => root.render(<NotificationsPopover />));
    await act(() => host.querySelector<HTMLButtonElement>('button')?.click());
    expect([...new Set(mocks.requestedProjects)]).toEqual(withRedirect ? ['redirect-site'] : []);
    expect(document.body.textContent).toContain('failures.connection');
  } finally {
    await act(() => root.unmount());
    host.remove();
  }
});

describe('organization scope', () => {
  const item = (id: string, organization: NotificationItem['organization'], project: NotificationItem['project']): NotificationItem => ({
    id,
    type: 'deploy_ready',
    projectId: project?.id ?? null,
    title: 'Ready',
    body: '',
    params: null,
    href: null,
    readAt: null,
    createdAt: '2026-11-07T00:00:00Z',
    organization,
    project,
  });
  async function open() {
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    await act(() => root.render(<NotificationsPopover />));
    await act(() => host.querySelector<HTMLButtonElement>('button')?.click());
    return async () => {
      await act(() => root.unmount());
      host.remove();
    };
  }

  it('says where each item comes from: "Org · Website", or just the org', async () => {
    mocks.items = [
      item('a', { id: 'org-1', slug: 'acme', name: 'Acme Docs', logo: null }, { id: 'p-1', name: 'Developer docs' }),
      item('b', { id: 'org-2', slug: 'jood', name: 'JOODPMS', logo: null }, null),
      item('c', null, null),
    ];
    const close = await open();
    try {
      const sources = [...document.querySelectorAll('[data-slot="notification-source"]')].map((node) => node.textContent);
      expect(sources).toHaveLength(2);
      expect(sources[0]).toContain('Acme Docs · Developer docs');
      expect(sources[1]).toContain('JOODPMS');
      expect(sources[1]).not.toContain(' · ');
    } finally {
      await close();
    }
  });

  it('has no This organization / All filter outside an organization', async () => {
    const close = await open();
    try {
      expect(document.querySelector('[aria-label="notifications.filter.label"]')).toBeNull();
      expect(mocks.notificationOptions.at(-1)).toEqual({ enabled: true, organizationId: undefined });
    } finally {
      await close();
    }
  });

  it('filters to the current organization only when "This organization" is chosen', async () => {
    mocks.organizationId = 'org-1';
    const close = await open();
    try {
      const filter = document.querySelector('[aria-label="notifications.filter.label"]') as HTMLElement;
      const [thisOrg, all] = [...filter.querySelectorAll<HTMLButtonElement>('button')];
      expect(thisOrg?.textContent).toBe('notifications.filter.organization');
      // All by default, so nothing is hidden by surprise.
      expect(all?.getAttribute('aria-pressed')).toBe('true');
      expect(mocks.notificationOptions.at(-1)).toEqual({ enabled: true, organizationId: undefined });
      await act(() => thisOrg?.click());
      expect(thisOrg?.getAttribute('aria-pressed')).toBe('true');
      expect(mocks.notificationOptions.at(-1)).toEqual({ enabled: true, organizationId: 'org-1' });
      await act(() => all?.click());
      expect(mocks.notificationOptions.at(-1)).toEqual({ enabled: true, organizationId: undefined });
    } finally {
      await close();
    }
  });
});
