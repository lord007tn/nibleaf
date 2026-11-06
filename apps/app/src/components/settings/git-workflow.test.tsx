// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';

const mutation = { mutate: vi.fn(), isPending: false };
vi.mock('@nibleaf/i18n/react', () => ({ useLocale: () => ({ locale: 'en', t: (key: string) => key }) }));
vi.mock('@/env', () => ({ env: { VITE_APP_URL: 'https://app.example.com' } }));
vi.mock('@/hooks/api', () => ({
  friendlyErrorMessage: (_t: unknown, _error: unknown, key: string) => key,
  useGitWorkflow: () => ({ isPending: true, data: undefined }),
  useAuthorizeGitWorkflow: () => mutation,
  useConnectGitWorkflow: () => mutation,
  useDisconnectGitWorkflow: () => mutation,
  useQueueGitOperation: () => mutation,
  useResolveGitConflict: () => mutation,
  useRotateGitWorkflowWebhookSecret: () => mutation,
}));

import { GitWorkflow } from './git-workflow';

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);

it('first loads as the connection card with its three steps, not as a generic form', async () => {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  try {
    await act(async () => root.render(<GitWorkflow projectId="site-1" />));

    const skeleton = host.querySelector('[data-slot="git-workflow-skeleton"]');
    expect(skeleton?.tagName).toBe('SECTION');
    expect(skeleton?.getAttribute('aria-busy')).toBe('true');
    expect(host.querySelectorAll('[role="status"]')).toHaveLength(1);
    expect(host.querySelector('[data-slot="git-workflow-skeleton-steps"]')?.children).toHaveLength(3);
    // Placeholder blocks are hidden from assistive tech; the status above announces the load.
    expect(host.querySelector('[data-slot="skeleton"]')?.closest('[aria-hidden="true"]')).not.toBeNull();
    expect(host.querySelector('input')).toBeNull();
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});
