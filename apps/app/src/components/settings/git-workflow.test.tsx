// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ confirm: vi.fn(), query: { isPending: true, data: undefined as unknown } }));
const mutation = { mutate: vi.fn(), isPending: false };
vi.mock('@nibleaf/design-system/components/ui/confirm', () => ({ useConfirm: () => state.confirm }));
vi.mock('@nibleaf/i18n/react', () => ({ useLocale: () => ({ locale: 'en', t: (key: string) => key }) }));
vi.mock('@/env', () => ({ env: { VITE_APP_URL: 'https://app.example.com' } }));
vi.mock('@/hooks/api', () => ({
  friendlyErrorMessage: (_t: unknown, _error: unknown, key: string) => key,
  useGitWorkflow: () => state.query,
  useAuthorizeGitWorkflow: () => mutation,
  useConnectGitWorkflow: () => mutation,
  useDisconnectGitWorkflow: () => mutation,
  useQueueGitOperation: () => mutation,
  useResolveGitConflict: () => mutation,
  useRotateGitWorkflowWebhookSecret: () => mutation,
}));

import { GitWorkflow } from './git-workflow';

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);

it('first loads as the shell both the connect and the connected screens share, not as either one', async () => {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  try {
    await act(async () => root.render(<GitWorkflow projectId="site-1" />));

    const skeleton = host.querySelector('[data-slot="git-workflow-skeleton"]');
    expect(skeleton?.tagName).toBe('SECTION');
    expect(skeleton?.getAttribute('aria-busy')).toBe('true');
    expect(host.querySelectorAll('[role="status"]')).toHaveLength(1);
    expect(host.querySelector('[data-slot="git-workflow-skeleton-header"]')).not.toBeNull();
    expect(host.querySelector('[data-slot="git-workflow-skeleton-body"]')).not.toBeNull();
    // Whether the site is connected isn't known yet: no three connect steps, no four connected actions.
    expect(host.querySelector('[data-slot="git-workflow-skeleton-steps"]')).toBeNull();
    expect(host.querySelector('[class*="grid-cols-3"], [class*="grid-cols-4"], nav')).toBeNull();
    // Placeholder blocks are hidden from assistive tech; the status above announces the load.
    expect(host.querySelector('[data-slot="skeleton"]')?.closest('[aria-hidden="true"]')).not.toBeNull();
    expect(host.querySelector('input')).toBeNull();
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});

it.each([false, true])('confirms webhook secret replacement before sending the request (%s)', async (approved) => {
  mutation.mutate.mockClear();
  state.confirm.mockResolvedValue(approved);
  state.query = {
    isPending: false,
    data: {
      repository: 'team/docs',
      baseBranch: 'main',
      headBranch: 'docs',
      contentPath: 'content',
      lastSyncStatus: 'READY',
      pullRequests: [],
      conflicts: [],
      operations: [],
    },
  };
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  try {
    await act(async () => root.render(<GitWorkflow projectId="site-1" />));
    const button = (key: string) => [...host.querySelectorAll('button')].find((item) => item.textContent?.includes(key));
    await act(async () => button('settings.git.workflow.nav.connection')?.click());
    expect(button('settings.git.workflow.rotateSecret')).toBeDefined();
    await act(async () => button('settings.git.workflow.rotateSecret')?.click());
    expect(state.confirm).toHaveBeenCalledWith(
      expect.objectContaining({ description: 'settings.git.workflow.rotateConfirm.description', destructive: true }),
    );
    expect(mutation.mutate).toHaveBeenCalledTimes(approved ? 1 : 0);
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});
