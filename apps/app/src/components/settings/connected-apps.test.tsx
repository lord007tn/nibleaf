/** @vitest-environment jsdom */

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

const hooks = vi.hoisted(() => ({
  useConnectedApps: vi.fn(),
  revoke: { isPending: false, mutate: vi.fn() },
}));

vi.mock('@nibleaf/i18n/react', () => ({ useLocale: () => ({ locale: 'en', t: (key: string) => key }) }));
vi.mock('@/hooks/api', () => ({ useConnectedApps: hooks.useConnectedApps, useRevokeConnectedApp: () => hooks.revoke }));

import { ConnectedApps, describeMcpActivity } from './connected-apps';

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);

const ADMIN = 'admin';

const at = '2026-11-06T10:00:00.000Z';
const activity = (operation: string, outcome: string, errorCode: string | null = null) => ({ operation, outcome, errorCode, at });

describe('describeMcpActivity', () => {
  it.each([
    ['publish_changes', 'settings.mcpActivity.published'],
    ['update_page', 'settings.mcpActivity.updatedPage'],
    ['create_page_draft', 'settings.mcpActivity.createdDraft'],
    ['translate_page', 'settings.mcpActivity.translatedPage'],
    ['preview_publish', 'settings.mcpActivity.previewedPublish'],
    ['search_pages', 'settings.mcpActivity.searchedPages'],
    ['get_top_searches', 'settings.mcpActivity.readAnalytics'],
    ['get_capabilities', 'settings.mcpActivity.checkedConnection'],
  ])('describes a successful %s', (operation, key) => {
    expect(describeMcpActivity(activity(operation, 'succeeded'), 'key')).toEqual({ key, tone: 'neutral' });
  });

  it('names other tools in readable words', () => {
    expect(describeMcpActivity(activity('list_versions', 'succeeded'), 'key')).toEqual({
      key: 'settings.mcpActivity.used',
      tool: 'list versions',
      tone: 'neutral',
    });
  });

  it('describes a replayed request', () => {
    expect(describeMcpActivity(activity('publish_changes', 'replayed'), 'key').key).toBe('settings.mcpActivity.replayed');
  });

  it.each([
    ['publish_changes', 'key', 'settings.mcpActivity.keyCantPublish'],
    ['update_page', 'key', 'settings.mcpActivity.keyCantEditPages'],
    ['get_page', 'key', 'settings.mcpActivity.keyNotAllowed'],
    ['preview_publish', 'app', 'settings.mcpActivity.appCantPublish'],
    ['translate_page', 'app', 'settings.mcpActivity.appCantEditPages'],
  ] as const)('names what a %s blocked by scope tried to do (%s)', (operation, subject, key) => {
    expect(describeMcpActivity(activity(operation, 'failed', 'mcp:scope_required'), subject)).toEqual({ key, tone: 'attention' });
  });

  it.each([
    ['mcp:revision_conflict', 'settings.mcpActivity.revisionConflict'],
    ['mcp:publish_in_progress', 'settings.mcpActivity.publishInProgress'],
    ['mcp:preview_stale', 'settings.mcpActivity.previewOutdated'],
    ['mcp:preview_expired', 'settings.mcpActivity.previewOutdated'],
    ['http:rate_limited', 'settings.mcpActivity.rateLimited'],
    ['auth:insufficient_role', 'settings.mcpActivity.roleBlocked'],
    ['http:internal', 'settings.mcpActivity.didntFinish'],
    [null, 'settings.mcpActivity.didntFinish'],
  ])('describes a failure with %s', (errorCode, key) => {
    expect(describeMcpActivity(activity('publish_changes', 'failed', errorCode), 'key')).toEqual({ key, tone: 'attention' });
  });
});

describe('ConnectedApps', () => {
  const roots: Array<ReturnType<typeof createRoot>> = [];
  afterEach(async () => {
    for (const root of roots.splice(0)) await act(async () => root.unmount());
    document.body.replaceChildren();
    hooks.revoke.isPending = false;
    hooks.revoke.mutate.mockReset();
  });
  const render = async (role = 'admin') => {
    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);
    roots.push(root);
    await act(async () => root.render(<ConnectedApps projectId="project-1" role={role} />));
    return container;
  };
  const app = {
    id: 'grant-1',
    name: 'ChatGPT',
    uri: 'https://chatgpt.com',
    preset: 'read_only',
    scopes: ['mcp:connect', 'pages:read'],
    createdAt: at,
    lastUsedAt: at,
    connectedBy: { id: 'user-1', name: 'Ada', email: 'ada@example.com' },
    ownedByViewer: true,
    lastActivity: activity('get_page', 'failed', 'http:rate_limited'),
  };

  it('shows row-shaped skeletons with one status while pending', async () => {
    hooks.useConnectedApps.mockReturnValue({ data: undefined, isError: false, isPending: true });
    const container = await render();
    expect(container.querySelector('[aria-busy="true"] [role="status"]')?.textContent).toBe('settings.connectedApps.loading');
    expect(container.textContent).not.toContain('settings.connectedApps.empty');
  });

  it('shows the plain sentence and keeps scopes in collapsed technical details', async () => {
    hooks.useConnectedApps.mockReturnValue({ data: [app], isError: false, isPending: false });
    const container = await render();
    const row = container.querySelector('li');
    expect(row?.textContent).toContain('settings.apiKeys.read_onlyDescription');
    expect(row?.querySelector('[data-tone="attention"]')?.textContent).toContain('settings.mcpActivity.rateLimited');
    const details = row?.querySelector('details');
    expect(details?.open).toBe(false);
    const scope = Array.from(row?.querySelectorAll('[data-slot="badge"]') ?? []).find((badge) => badge.textContent === 'pages:read');
    expect(scope?.closest('details')).toBe(details);
    expect(details?.textContent).toContain('get_page');
  });

  it('confirms before disconnecting and shows the confirm button loading', async () => {
    hooks.useConnectedApps.mockReturnValue({ data: [app], isError: false, isPending: false });
    const container = await render();
    const disconnect = Array.from(container.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('settings.connectedApps.disconnect'),
    );
    await act(async () => disconnect?.click());
    const dialog = document.querySelector('[role="alertdialog"]');
    const confirm = Array.from(dialog?.querySelectorAll('button') ?? []).find((button) =>
      button.textContent?.includes('settings.connectedApps.disconnect'),
    );
    await act(async () => confirm?.click());
    expect(hooks.revoke.mutate).toHaveBeenCalledWith('grant-1', expect.any(Object));

    hooks.revoke.isPending = true;
    await act(async () => roots[0]?.render(<ConnectedApps projectId="project-1" role={ADMIN} />));
    const loading = Array.from(document.querySelectorAll('[role="alertdialog"] button')).find((button) =>
      button.textContent?.includes('settings.connectedApps.disconnect'),
    );
    expect(loading?.getAttribute('aria-busy')).toBe('true');
  });
});
