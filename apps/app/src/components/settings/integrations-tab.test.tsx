/** @vitest-environment jsdom */

import { INTEGRATION_CATALOG, type IntegrationCatalogEntry } from '@nibleaf/shared/integrations';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const hooks = vi.hoisted(() => {
  const mutation = () => ({ isPending: false, mutateAsync: vi.fn() });
  return {
    integrations: vi.fn(),
    create: mutation(),
    update: mutation(),
    activate: mutation(),
    deactivate: mutation(),
    verify: mutation(),
    remove: mutation(),
  };
});

vi.mock('@nibleaf/i18n/react', () => ({ useT: () => (key: string) => key }));
vi.mock('@tanstack/react-router', () => ({ useNavigate: () => vi.fn() }));
vi.mock('@/components/project-settings/analytics-section', () => ({ AnalyticsSection: () => null }));
vi.mock('@/hooks/api', () => ({
  useProjectIntegrations: hooks.integrations,
  useCreateProjectIntegration: () => hooks.create,
  useUpdateProjectIntegration: () => hooks.update,
  useActivateProjectIntegration: () => hooks.activate,
  useDeactivateProjectIntegration: () => hooks.deactivate,
  useVerifyProjectIntegration: () => hooks.verify,
  useDeleteProjectIntegration: () => hooks.remove,
}));

import { IntegrationsTab } from './integrations-tab';

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);

const roots: Array<ReturnType<typeof createRoot>> = [];
const slack = INTEGRATION_CATALOG.find((entry) => entry.id === 'slack');
const entry = (overrides: Partial<IntegrationCatalogEntry> = {}): IntegrationCatalogEntry =>
  ({ ...slack, availability: 'available', connection: null, ...overrides }) as IntegrationCatalogEntry;
const project = { id: 'project-1', name: 'Docs' } as Parameters<typeof IntegrationsTab>[0]['project'];

async function renderTab() {
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  await act(async () => root.render(<IntegrationsTab project={project} projectId="project-1" />));
  return container;
}
const button = (container: ParentNode, label: string) =>
  Array.from(container.querySelectorAll('button')).find((element) => element.textContent?.includes(label));

beforeEach(() => {
  for (const mutation of [hooks.create, hooks.update, hooks.activate, hooks.deactivate, hooks.verify, hooks.remove]) {
    mutation.isPending = false;
    mutation.mutateAsync.mockReset();
  }
});
afterEach(async () => {
  for (const root of roots.splice(0)) await act(async () => root.unmount());
  document.body.replaceChildren();
});

describe('integrations catalog loading', () => {
  it('shows card-shaped skeletons with one status while the catalog first loads', async () => {
    hooks.integrations.mockReturnValue({ isPending: true, isSuccess: false, isError: false });
    const container = await renderTab();
    const busy = container.querySelector('[aria-busy="true"]');
    expect(busy).not.toBeNull();
    expect(busy?.querySelectorAll('[role="status"]')).toHaveLength(1);
    expect(busy?.querySelectorAll('.min-h-36')).toHaveLength(6);
    expect(container.textContent).not.toContain('settings.integrations.noResults');
  });

  it('shows a plain retryable error instead of the server text', async () => {
    const refetch = vi.fn();
    hooks.integrations.mockReturnValue({ isPending: false, isSuccess: false, isError: true, error: new Error('ECONNREFUSED 10.0.0.4'), refetch });
    const container = await renderTab();
    expect(container.textContent).toContain('settings.integrations.loadError');
    expect(container.textContent).not.toContain('ECONNREFUSED');
    await act(async () => button(container, 'common.retry')?.click());
    expect(refetch).toHaveBeenCalledOnce();
  });
});

describe('integration actions', () => {
  const openSlack = async (connection: IntegrationCatalogEntry['connection']) => {
    hooks.integrations.mockReturnValue({ isPending: false, isSuccess: true, isError: false, data: [entry({ connection })] });
    const container = await renderTab();
    await act(async () => button(container, 'settings.integrations.provider.slack')?.click());
    return container;
  };

  it('marks Connect as loading while the connection is being created', async () => {
    hooks.create.isPending = true;
    const container = await openSlack(null);
    const connect = button(container, 'settings.integrations.connect');
    expect(connect?.getAttribute('aria-busy')).toBe('true');
    expect(connect?.disabled).toBe(true);
  });

  it('marks only the status button as loading while activating', async () => {
    hooks.activate.isPending = true;
    const container = await openSlack({
      id: 'connection-1',
      providerId: 'slack',
      category: 'webhook',
      ownership: 'project',
      status: 'inactive',
      health: { status: 'unverified', checkedAt: null, code: null },
      credential: { configured: true },
      config: { providerId: 'slack', label: 'Alerts' },
      revision: 3,
      createdAt: '2026-11-06T00:00:00.000Z',
      updatedAt: '2026-11-06T00:00:00.000Z',
    });
    expect(button(container, 'settings.integrations.activate')?.getAttribute('aria-busy')).toBe('true');
    expect(button(container, 'common.save')?.getAttribute('aria-busy')).not.toBe('true');
    expect(button(container, 'common.save')?.disabled).toBe(true);
  });
});
