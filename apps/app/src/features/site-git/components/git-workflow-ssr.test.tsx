// @vitest-environment jsdom
// GitWorkflow server-rendered, as the project settings route renders its Git section, then hydrated: loading, not
// connected (the connect wizard) and connected (with the Connection configuration form). The status comes from the
// cache as a server render finds it; the app's QueryClient, every request replaced. Fictional site and repository.
import { ConfirmProvider } from '@nibleaf/design-system/components/ui/confirm';
import { QueryClientProvider } from '@tanstack/react-query';
import { act } from 'react';
import { hydrateRoot, type Root } from 'react-dom/client';
import { renderToString } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ statusGet: vi.fn() }));
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
vi.mock('@nibleaf/i18n/react', async () => {
  const { translateFn: translate } = await vi.importActual<typeof import('@nibleaf/i18n')>('@nibleaf/i18n');
  const t = (key: Parameters<typeof translate>[0], variables?: Parameters<typeof translate>[1]) => translate(key, variables, 'en');
  return { useT: () => t, useLocale: () => ({ locale: 'en', t }) };
});
vi.mock('@/env', () => ({ env: { VITE_APP_URL: 'https://app.fixture.test' } }));
vi.mock('@/services/api', () => {
  const node = (path: string[]): unknown =>
    new Proxy(() => undefined, {
      get: (_target, property) => (typeof property === 'string' && property !== 'then' ? node([...path, property]) : undefined),
      apply: (_target, _this, args: unknown[]) => {
        if (path.slice(3).join('.') === 'git.$get') return mocks.statusGet(args[0]);
        throw new Error(`unexpected API call ${path.join('.')}`);
      },
    });
  return { api: node([]) };
});

import { GitWorkflow } from '@/components/settings/git-workflow';
import { gitWorkflowQueryOptions } from '@/hooks/api/query-options';
import { createQueryClient } from '@/integrations/tanstack-query/query-client';

const status = {
  id: 'connection-site-a',
  repository: 'acme-fixture/handbook',
  baseBranch: 'main',
  headBranch: 'nibleaf/docs',
  contentPath: 'docs',
  importBranchId: null,
  importLanguageId: null,
  credentialConfigured: true,
  webhookConfigured: true,
  lastSyncStatus: 'IDLE',
  lastSyncError: null,
  lastSyncedAt: null,
  operations: [],
  pullRequests: [],
  files: [],
};
const STATES = {
  loading: undefined,
  'not connected': null,
  connected: status,
} as const;

/** A QueryClient holding the site's status as `state` has it (none while loading). */
const clientFor = (state: keyof typeof STATES) => {
  const client = createQueryClient();
  const data = STATES[state];
  if (data !== undefined) client.setQueryData(gitWorkflowQueryOptions('site-a').queryKey, data);
  return client;
};
const page = (client: ReturnType<typeof createQueryClient>) => (
  <QueryClientProvider client={client}>
    <ConfirmProvider>
      <GitWorkflow key="git-site-a" projectId="site-a" />
    </ConfirmProvider>
  </QueryClientProvider>
);

let root: Root | undefined;
let container: HTMLDivElement | undefined;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  // The status read after hydration: the loading screen's own fetch; it never resolves, so the hydrated HTML is compared.
  mocks.statusGet.mockReset().mockImplementation(() => new Promise(() => undefined));
});
afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  container?.remove();
  root = undefined;
  container = undefined;
  vi.unstubAllGlobals();
});

describe('GitWorkflow on the server', () => {
  it.each(Object.keys(STATES) as Array<keyof typeof STATES>)('renders %s without throwing, and hydrates without a mismatch', async (state) => {
    let html = '';
    expect(() => {
      html = renderToString(page(clientFor(state)));
    }).not.toThrow();
    if (state === 'loading') expect(html).toContain('data-slot="git-workflow-skeleton"');
    if (state === 'not connected') expect(html).toContain('id="git2-token"');
    if (state === 'connected') expect(html).toContain('id="git2-update-repo"');

    container = document.createElement('div');
    container.innerHTML = html;
    document.body.append(container);
    // The server HTML as the browser parses it (attribute case and entities normalized), before hydration.
    const parsed = container.innerHTML;
    const errors: unknown[] = [];
    const logged = vi.spyOn(console, 'error');
    await act(async () => {
      root = hydrateRoot(container as HTMLDivElement, page(clientFor(state)), { onRecoverableError: (error) => errors.push(error) });
    });
    expect(errors).toEqual([]);
    expect(logged).not.toHaveBeenCalled();
    expect(container.innerHTML).toBe(parsed);
  });
});
