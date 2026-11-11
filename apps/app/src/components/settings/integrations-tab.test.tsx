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

const manifest = (id: IntegrationCatalogEntry['id']) => INTEGRATION_CATALOG.find((candidate) => candidate.id === id);
const catalogOf = (...entries: IntegrationCatalogEntry[]) =>
  hooks.integrations.mockReturnValue({ isPending: false, isSuccess: true, isError: false, data: entries });
const storedSlack: NonNullable<IntegrationCatalogEntry['connection']> = {
  id: 'connection-1',
  providerId: 'slack',
  category: 'webhook',
  ownership: 'project',
  status: 'active',
  health: { status: 'unverified', checkedAt: null, code: null },
  credential: { configured: true },
  config: { providerId: 'slack', label: 'Alerts' },
  revision: 3,
  createdAt: '2026-11-06T00:00:00.000Z',
  updatedAt: '2026-11-06T00:00:00.000Z',
};

describe('AI provider details', () => {
  it.each(['openai', 'openrouter'] as const)('%s links to Smart AI, never to Git settings', async (id) => {
    catalogOf({ ...manifest(id), availability: 'available', connection: null } as IntegrationCatalogEntry);
    const container = await renderTab();
    await act(async () => button(container, `settings.integrations.provider.${id}`)?.click());

    expect(button(container, 'settings.integrations.openSmartAi')).toBeDefined();
    expect(container.textContent).toContain('settings.integrations.smartAiOwned');
    expect(container.textContent).not.toContain('settings.integrations.openGitSettings');
    expect(container.textContent).not.toContain('settings.integrations.adapterOwned');
  });

  it('keeps the Git settings link for Git providers', async () => {
    catalogOf({ ...manifest('github'), availability: 'available', connection: null } as IntegrationCatalogEntry);
    const container = await renderTab();
    await act(async () => button(container, 'settings.integrations.provider.github')?.click());

    expect(button(container, 'settings.integrations.openGitSettings')).toBeDefined();
    expect(container.textContent).not.toContain('settings.integrations.openSmartAi');
  });
});

describe('Slack, Discord and Zapier while coming soon', () => {
  it('shows them as coming soon with no way to connect', async () => {
    catalogOf(
      ...(['slack', 'discord', 'zapier'] as const).map(
        (id) => ({ ...manifest(id), availability: 'coming_soon', connection: null }) as IntegrationCatalogEntry,
      ),
    );
    const container = await renderTab();

    const cards = container.querySelectorAll('[data-coming-soon]');
    expect(cards).toHaveLength(3);
    for (const card of cards) {
      expect(card.textContent).toContain('settings.integrations.availability.comingSoon');
      expect(card.textContent).toContain('settings.integrations.comingSoon.description');
    }
    // Nothing to open: the cards are not buttons, so there is no connect form behind them.
    expect(button(container, 'settings.integrations.provider.slack')).toBeUndefined();
    expect(container.querySelectorAll('input')).toHaveLength(1); // the catalog search only
    expect(container.textContent).not.toContain('settings.integrations.connect');
  });

  it('shows a stored connection as not sending yet, with Remove as the only action', async () => {
    catalogOf({ ...manifest('slack'), availability: 'coming_soon', connection: storedSlack } as IntegrationCatalogEntry);
    const container = await renderTab();
    const card = button(container, 'settings.integrations.provider.slack');
    expect(card?.textContent).toContain('settings.integrations.status.notSendingYet');

    await act(async () => card?.click());

    const actions = Array.from(container.querySelectorAll('button')).map((element) => element.textContent?.trim());
    expect(actions).toEqual(['settings.integrations.allIntegrations', 'settings.integrations.remove']);
    expect(container.querySelector('input')).toBeNull();
    for (const absent of ['sendTest', 'verify', 'deactivate', 'activate', 'connect']) {
      expect(container.textContent).not.toContain(`settings.integrations.${absent}`);
    }
    expect(container.textContent).toContain('Alerts');
  });

  it('removes a stored connection after confirming', async () => {
    hooks.remove.mutateAsync.mockResolvedValue(undefined);
    catalogOf({ ...manifest('slack'), availability: 'coming_soon', connection: storedSlack } as IntegrationCatalogEntry);
    const container = await renderTab();
    await act(async () => button(container, 'settings.integrations.provider.slack')?.click());
    await act(async () => button(container, 'settings.integrations.remove')?.click());

    const dialog = document.querySelector('[role="dialog"]');
    expect(dialog?.textContent).toContain('settings.integrations.removeTitle');
    const confirm = Array.from(dialog?.querySelectorAll('button') ?? []).find(
      (element) => element.textContent?.trim() === 'settings.integrations.remove',
    );
    await act(async () => confirm?.click());

    expect(hooks.remove.mutateAsync).toHaveBeenCalledWith({ providerId: 'slack', expectedRevision: 3 });
  });
});

describe('AI provider card status', () => {
  const aiConnection = (
    ownership: 'project' | 'instance',
    status: 'active' | 'inactive' | 'error',
  ): NonNullable<IntegrationCatalogEntry['connection']> => ({
    ...storedSlack,
    id: `ai-${ownership}`,
    providerId: 'openai',
    category: 'ai',
    ownership,
    status,
    config: { providerId: 'openai', answerModel: 'openai/gpt-6-luna', embeddingModel: 'openai/text-embedding-3-large' },
  });

  it.each([
    { ownership: 'project', status: 'inactive', label: 'settings.integrations.status.notInUse' },
    { ownership: 'project', status: 'active', label: 'settings.integrations.status.active' },
    { ownership: 'project', status: 'error', label: 'settings.integrations.status.error' },
    { ownership: 'instance', status: 'inactive', label: 'settings.integrations.status.inactive' },
  ] as const)('a $ownership key that is $status reads "$label"', async ({ ownership, status, label }) => {
    catalogOf({ ...manifest('openai'), availability: 'available', connection: aiConnection(ownership, status) } as IntegrationCatalogEntry);
    const container = await renderTab();

    expect(button(container, 'settings.integrations.provider.openai')?.textContent).toContain(label);
  });
});
