// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';

const mutation = { mutate: vi.fn(), isPending: false };
const query = vi.hoisted(() => ({ use: vi.fn() }));
vi.mock('@nibleaf/i18n/react', () => ({ useT: () => (key: string) => key, useLocale: () => ({ locale: 'en', t: (key: string) => key }) }));
vi.mock('@/env', () => ({ env: { VITE_APP_URL: 'https://app.example.com' } }));
vi.mock('@/hooks/api', () => ({
  friendlyErrorMessage: (_t: unknown, _error: unknown, key: string) => key,
  useGitWorkflow: query.use,
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
  query.use.mockReturnValue({ isPending: true, data: undefined });
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

it('localizes both connection and operation failures and keeps details collapsed', async () => {
  query.use.mockReturnValue({
    isPending: false,
    data: {
      repository: 'fixture/docs',
      baseBranch: 'main',
      headBranch: 'docs',
      contentPath: 'docs',
      lastSyncStatus: 'FAILED',
      lastSyncError: 'Bad credentials: provider trace',
      lastSyncedAt: null,
      operations: [
        {
          id: 'op-1',
          status: 'FAILED',
          kind: 'PULL',
          commitMessage: 'Fixture',
          createdAt: '2026-11-07',
          changedFiles: [],
          conflicts: [],
          error: 'ProviderError: fetch failed',
        },
      ],
      pullRequests: [],
    },
  });
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  try {
    await act(() => root.render(<GitWorkflow projectId="site-1" />));
    expect(host.textContent).toContain('failures.access');
    expect(host.textContent).toContain('failures.connection');
    expect([...host.querySelectorAll('details')].map((details) => details.open)).toEqual([false, false]);
    expect([...host.querySelectorAll('pre')].map((pre) => pre.textContent)).toEqual([
      'Bad credentials: provider trace',
      'ProviderError: fetch failed',
    ]);
    expect([...host.querySelectorAll('p')].some((p) => p.textContent?.includes('provider trace'))).toBe(false);
  } finally {
    await act(() => root.unmount());
    host.remove();
  }
});
