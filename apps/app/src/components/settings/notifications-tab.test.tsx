// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ query: vi.fn(), mutate: vi.fn(), refetch: vi.fn() }));
vi.mock('@nibleaf/i18n/react', () => ({ useT: () => (key: string) => key }));
vi.mock('@/hooks/api', () => ({ useWorkspaceSettings: mocks.query, useUpdateWorkspaceSettings: () => ({ mutate: mocks.mutate }) }));
vi.mock('@/services/auth-client', () => ({ useSession: () => ({ data: { user: { email: 'writer@example.com' } } }) }));

import { NotificationsTab } from './notifications-tab';

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
const host = document.createElement('div');
document.body.append(host);
let root = createRoot(host);
afterEach(async () => {
  await act(async () => root.unmount());
  root = createRoot(host);
  vi.clearAllMocks();
});
it('does not offer preference switches until saved settings have loaded', async () => {
  mocks.query.mockReturnValue({ isPending: true });
  await act(async () => root.render(<NotificationsTab />));
  expect(host.querySelector('[role="status"]')?.textContent).toBe('common.loading');
  expect(host.querySelector('[role="switch"]')).toBeNull();
  expect(mocks.mutate).not.toHaveBeenCalled();
});
it('offers retry after an initial read failure', async () => {
  mocks.query.mockReturnValue({ isError: true, refetch: mocks.refetch });
  await act(async () => root.render(<NotificationsTab />));
  expect(host.querySelector('[role="alert"]')).not.toBeNull();
  expect(host.querySelector('[role="switch"]')).toBeNull();
  await act(async () => host.querySelector('button')?.click());
  expect(mocks.refetch).toHaveBeenCalledOnce();
});
it('retains saved preferences but disables changes after a failed refresh', async () => {
  mocks.query.mockReturnValue({ data: { notifications: { deploy_success: false } }, isError: true, refetch: mocks.refetch });
  await act(async () => root.render(<NotificationsTab />));
  const switches = [...host.querySelectorAll<HTMLButtonElement>('[role="switch"]')];
  expect(switches.length).toBeGreaterThan(0);
  expect(switches.every((control) => control.disabled || control.getAttribute('aria-disabled') === 'true')).toBe(true);
  expect(host.querySelector('[role="alert"]')).not.toBeNull();
});
