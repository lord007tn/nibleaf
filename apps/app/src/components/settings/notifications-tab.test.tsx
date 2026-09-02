// @vitest-environment jsdom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@nibleaf/i18n/react', () => ({ useT: () => (key: string) => key }));
vi.mock('@/hooks/api', () => ({
  useWorkspaceSettings: () => ({ data: { notifications: {} } }),
  useUpdateWorkspaceSettings: () => ({ isPending: false, mutate: vi.fn() }),
}));
vi.mock('@/services/auth-client', () => ({ useSession: () => ({ data: { user: { email: 'reader@example.com' } } }) }));

import { NotificationsTab } from './notifications-tab';

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);

describe('NotificationsTab', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  it('associates every notification switch with its visible label and description', async () => {
    await act(async () => root.render(<NotificationsTab projectId="project-1" />));

    const switches = [...container.querySelectorAll<HTMLElement>('[role="switch"]')];
    expect(switches).toHaveLength(8);
    for (const control of switches) {
      const labelId = control.getAttribute('aria-labelledby');
      const descriptionId = control.getAttribute('aria-describedby');
      expect(labelId).toBeTruthy();
      expect(descriptionId).toBeTruthy();
      expect(document.getElementById(labelId ?? '')?.textContent).toBeTruthy();
      expect(document.getElementById(descriptionId ?? '')?.textContent).toBeTruthy();
    }
  });
});
