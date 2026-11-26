/** @vitest-environment jsdom */

import { INTEGRATION_CATALOG, type IntegrationCatalogEntry } from '@nibleaf/shared/integrations';
import { act, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const hooks = vi.hoisted(() => {
  const mutation = () => ({ isPending: false, mutateAsync: vi.fn() });
  return {
    integrations: vi.fn(),
    navigate: vi.fn(),
    save: { pending: false, save: vi.fn(), retire: vi.fn() },
    activate: mutation(),
    deactivate: mutation(),
    verify: mutation(),
    remove: mutation(),
  };
});

vi.mock('@nibleaf/i18n/react', () => ({ useT: () => (key: string) => key }));
// A link renders where it leads, so the tests can read each card's destination.
vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => hooks.navigate,
  Link: ({ children, className, search }: { children?: ReactNode; className?: string; search?: Record<string, string> }) => (
    <a className={className} data-search={JSON.stringify(search)} href="#settings">
      {children}
    </a>
  ),
}));
vi.mock('@/features/site-analytics-settings/components/analytics-settings', () => ({
  AnalyticsSettings: () => <form data-testid="analytics-form" />,
}));
vi.mock('@/features/site-integrations/components/use-webhook-integration-save-command', () => ({
  useWebhookIntegrationSaveCommand: () => hooks.save,
}));
vi.mock('@/hooks/api', () => ({
  useProjectIntegrations: hooks.integrations,
  useActivateProjectIntegration: () => hooks.activate,
  useDeactivateProjectIntegration: () => hooks.deactivate,
  useVerifyProjectIntegration: () => hooks.verify,
  useDeleteProjectIntegration: () => hooks.remove,
}));

import { IntegrationsTab } from './integrations-tab';

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);

type Connection = NonNullable<IntegrationCatalogEntry['connection']>;
const roots: Array<ReturnType<typeof createRoot>> = [];
const manifest = (id: IntegrationCatalogEntry['id']) => INTEGRATION_CATALOG.find((candidate) => candidate.id === id);
const entry = (id: IntegrationCatalogEntry['id'], overrides: Partial<IntegrationCatalogEntry> = {}) =>
  ({
    ...manifest(id),
    availability: manifest(id)?.comingSoon ? 'coming_soon' : 'available',
    connection: null,
    ...overrides,
  }) as IntegrationCatalogEntry;
const project = { id: 'project-1', name: 'Docs' } as Parameters<typeof IntegrationsTab>[0]['project'];
const catalogOf = (...entries: IntegrationCatalogEntry[]) =>
  hooks.integrations.mockReturnValue({ isPending: false, isSuccess: true, isError: false, data: entries });
const storedSlack: Connection = {
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

async function renderTab(integration?: Parameters<typeof IntegrationsTab>[0]['integration']) {
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  await act(async () => root.render(<IntegrationsTab integration={integration} project={project} projectId="project-1" />));
  return container;
}
const button = (container: ParentNode, label: string) =>
  Array.from(container.querySelectorAll('button')).find((element) => element.textContent?.includes(label));
const links = (container: ParentNode) => Array.from(container.querySelectorAll<HTMLAnchorElement>('a'));
const linkTo = (container: ParentNode, text: string) => links(container).find((element) => element.textContent?.includes(text));
const searchOf = (link: HTMLAnchorElement | undefined) => JSON.parse(link?.dataset.search ?? 'null');

beforeEach(() => {
  hooks.save.pending = false;
  hooks.navigate.mockReset();
  for (const mutation of [hooks.activate, hooks.deactivate, hooks.verify, hooks.remove]) {
    mutation.isPending = false;
    mutation.mutateAsync.mockReset();
  }
});
afterEach(async () => {
  for (const root of roots.splice(0)) await act(async () => root.unmount());
  document.body.replaceChildren();
});

describe('integrations hub loading', () => {
  it('shows the page title at once and card-shaped skeletons with one status while the catalog first loads', async () => {
    hooks.integrations.mockReturnValue({ isPending: true, isSuccess: false, isError: false });
    const container = await renderTab();
    expect(container.querySelector('h1')?.textContent).toBe('settings.integrations.title');
    const busy = container.querySelector('[aria-busy="true"]');
    expect(busy?.querySelectorAll('[role="status"]')).toHaveLength(1);
    expect(busy?.querySelectorAll('[data-slot="integration-card-skeleton"]')).toHaveLength(4);
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

describe('the hub shows only what a site owner connects', () => {
  it('groups the cards by job and never shows the server’s services or the AI providers', async () => {
    catalogOf(...INTEGRATION_CATALOG.map((item) => entry(item.id)));
    const container = await renderTab();

    expect(Array.from(container.querySelectorAll('h2')).map((heading) => heading.textContent)).toEqual([
      'settings.integrations.group.sync',
      'settings.integrations.group.analytics',
      'settings.integrations.group.notifications',
      'settings.integrations.group.automation',
    ]);
    for (const hidden of ['openai', 'openrouter', 'qdrant', 'clickhouse', 'postmark', 'smtp', 'maxio', 'minio', 'amazonS3', 'cloudflare']) {
      expect(container.textContent).not.toContain(`settings.integrations.provider.${hidden}`);
    }
    for (const word of ['availability.available', 'availability.notConfigured', 'availability.unavailable', 'health', 'ownership']) {
      expect(container.textContent).not.toContain(`settings.integrations.${word}`);
    }
  });

  it('points people looking for an AI key to the AI answers page', async () => {
    catalogOf(entry('github'));
    const container = await renderTab();
    const pointer = container.querySelector('[data-slot="ai-keys-pointer"]');
    expect(pointer?.textContent).toContain('settings.integrations.aiPointer');
    expect(searchOf(pointer?.querySelector('a') ?? undefined)).toEqual({ section: 'ai' });
  });

  it('sends GitHub to the Git page, with its one action or what it syncs', async () => {
    catalogOf(entry('github'));
    const container = await renderTab();
    const card = linkTo(container, 'settings.integrations.provider.github');
    expect(searchOf(card)).toEqual({ section: 'git' });
    expect(card?.textContent).toContain('settings.integrations.setUp');
  });

  it('opens one Analytics page from either analytics card and says what is tracked', async () => {
    catalogOf(
      entry('google-analytics', {
        connection: { ...storedSlack, providerId: 'google-analytics', config: { providerId: 'google-analytics', measurementId: 'G-TEST123' } },
      }),
      entry('plausible'),
    );
    const container = await renderTab();
    const ga = linkTo(container, 'settings.integrations.provider.googleAnalytics');
    expect(searchOf(ga)).toEqual({ section: 'integrations', integration: 'analytics' });
    expect(ga?.textContent).toContain('settings.integrations.connected');
    expect(ga?.textContent).toContain('G-TEST123');
    expect(searchOf(linkTo(container, 'settings.integrations.provider.plausible'))).toEqual({ section: 'integrations', integration: 'analytics' });
  });
});

describe('moving between the hub and an integration', () => {
  it('starts at the new page’s heading, as changing settings page does', async () => {
    catalogOf(entry('google-analytics'));
    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);
    roots.push(root);
    const show = (integration?: 'analytics') =>
      act(async () => root.render(<IntegrationsTab integration={integration} project={project} projectId="project-1" />));
    await show();
    expect(document.activeElement).toBe(document.body);
    await show('analytics');
    expect(document.activeElement?.textContent).toBe('settings.analytics.title');
    await show();
    expect(document.activeElement?.textContent).toBe('settings.integrations.title');
  });
});

describe('a link straight to an integration', () => {
  it('takes focus from the page when the integration appears after the list loads', async () => {
    hooks.integrations.mockReturnValue({ isPending: true, isSuccess: false, isError: false });
    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);
    roots.push(root);
    const show = () => act(async () => root.render(<IntegrationsTab integration="slack" project={project} projectId="project-1" />));
    await show();
    expect(container.querySelector('h1')?.textContent).toBe('settings.integrations.title');
    catalogOf(entry('slack', { connection: storedSlack }));
    await show();
    expect(document.activeElement?.tagName).toBe('H1');
    expect(document.activeElement?.textContent).toBe('settings.integrations.provider.slack');
  });
});

describe('the Analytics page', () => {
  it('is its own page with a way back to the hub', async () => {
    catalogOf(entry('google-analytics'));
    const container = await renderTab('analytics');
    expect(container.querySelector('h1')?.textContent).toBe('settings.analytics.title');
    expect(container.querySelector('[data-testid="analytics-form"]')).not.toBeNull();
    expect(searchOf(linkTo(container, 'settings.integrations.allIntegrations'))).toEqual({ section: 'integrations' });
  });
});

describe('Slack, Discord and Zapier while coming soon', () => {
  it('shows them as coming soon with no way to connect', async () => {
    catalogOf(entry('slack'), entry('discord'), entry('zapier'));
    const container = await renderTab();

    const cards = container.querySelectorAll('[data-coming-soon]');
    expect(cards).toHaveLength(3);
    for (const card of cards) {
      expect(card.textContent).toContain('settings.integrations.availability.comingSoon');
      expect(card.textContent).toContain('settings.integrations.comingSoon.description');
    }
    // Nothing to open: the cards are not links, so there is no connect form behind them.
    expect(linkTo(container, 'settings.integrations.provider.slack')).toBeUndefined();
    expect(container.querySelectorAll('input')).toHaveLength(0);
    expect(container.textContent).not.toContain('settings.integrations.connect');
  });

  it('shows a stored connection as not sending yet; its page offers Remove only', async () => {
    catalogOf(entry('slack', { connection: storedSlack }));
    const hub = await renderTab();
    const card = linkTo(hub, 'settings.integrations.provider.slack');
    expect(card?.textContent).toContain('settings.integrations.status.notSendingYet');
    expect(searchOf(card)).toEqual({ section: 'integrations', integration: 'slack' });

    const page = await renderTab('slack');
    const actions = Array.from(page.querySelectorAll('button')).map((element) => element.textContent?.trim());
    expect(actions).toEqual(['settings.integrations.remove']);
    expect(page.querySelector('input')).toBeNull();
    for (const absent of ['sendTest', 'verify', 'deactivate', 'activate', 'connect']) {
      expect(page.textContent).not.toContain(`settings.integrations.${absent}`);
    }
    expect(page.textContent).toContain('Alerts');
  });

  it('removes a stored connection after confirming, then goes back to the hub', async () => {
    hooks.remove.mutateAsync.mockResolvedValue(undefined);
    catalogOf(entry('slack', { connection: storedSlack }));
    const container = await renderTab('slack');
    await act(async () => button(container, 'settings.integrations.remove')?.click());

    const dialog = document.querySelector('[role="dialog"]');
    expect(dialog?.textContent).toContain('settings.integrations.removeTitle');
    const confirm = Array.from(dialog?.querySelectorAll('button') ?? []).find(
      (element) => element.textContent?.trim() === 'settings.integrations.remove',
    );
    await act(async () => confirm?.click());

    expect(hooks.remove.mutateAsync).toHaveBeenCalledWith({ providerId: 'slack', expectedRevision: 3 });
    expect(hooks.navigate).toHaveBeenCalledWith(expect.objectContaining({ search: { section: 'integrations' } }));
  });

  it('falls back to the hub when the link names an integration with nothing to show', async () => {
    catalogOf(entry('slack'));
    const container = await renderTab('slack');
    expect(container.querySelector('h1')?.textContent).toBe('settings.integrations.title');
  });
});

describe('a live webhook integration', () => {
  const live = (connection: Connection | null) => entry('slack', { availability: 'available', comingSoon: false, connection });

  it('marks Connect as loading while the connection is being created', async () => {
    hooks.save.pending = true;
    catalogOf(live(null));
    const container = await renderTab('slack');
    const connect = button(container, 'settings.integrations.connect');
    expect(connect?.getAttribute('aria-busy')).toBe('true');
    expect(connect?.disabled).toBe(true);
  });

  it('marks only the status button as loading while activating', async () => {
    hooks.activate.isPending = true;
    catalogOf(live({ ...storedSlack, status: 'inactive' }));
    const container = await renderTab('slack');
    expect(button(container, 'settings.integrations.activate')?.getAttribute('aria-busy')).toBe('true');
    expect(button(container, 'common.save')?.getAttribute('aria-busy')).not.toBe('true');
    expect(button(container, 'common.save')?.disabled).toBe(true);
  });
});
