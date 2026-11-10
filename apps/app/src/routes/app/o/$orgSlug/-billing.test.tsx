// @vitest-environment jsdom
import { act, type ComponentType, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type OrgRole = 'owner' | 'admin' | 'member';

const mocks = vi.hoisted(() => ({
  orgRole: 'owner' as OrgRole,
  usage: {} as Record<string, unknown>,
  usageFor: vi.fn(),
  overview: vi.fn(),
}));

vi.mock('@nibleaf/i18n/react', () => ({
  useT: () => (key: string, vars?: Record<string, string>) => (vars ? `${key}(${Object.values(vars).join('|')})` : key),
}));
vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (options: Record<string, unknown>) => ({ options }),
  Link: ({ children, to, params, className }: { children: ReactNode; to: string; params?: Record<string, string>; className?: string }) => (
    <a className={className} href={to.replace('$orgSlug', params?.orgSlug ?? '').replace('$projectId', params?.projectId ?? '')}>
      {children}
    </a>
  ),
}));
vi.mock('@/components/organization/organization-context', () => ({
  useCurrentOrganization: () => ({ id: 'org-1', slug: 'acme', name: 'Acme Docs', logo: null, orgRole: mocks.orgRole, canCreateWebsite: true }),
  isOrgAdmin: (organization: { orgRole: OrgRole }) => organization.orgRole !== 'member',
}));
vi.mock('@/components/settings/usage-tab', () => ({
  unavailableExplanationKey: (reason?: string | null) => (reason ? `reason:${reason}` : 'settings.usage.unknownExplanation'),
  UsageOverview: (props: { planKey: string | null; isPending: boolean }) => {
    mocks.overview(props);
    return <div data-plan={props.planKey ?? ''} data-testid="usage-overview" />;
  },
}));
vi.mock('@/hooks/api', () => ({
  useOrganizationUsage: (id?: string) => {
    mocks.usageFor(id);
    return mocks.usage;
  },
}));
vi.mock('@/hooks/api/organization-query-options', () => ({ organizationUsageQueryOptions: (id: string) => ({ queryKey: ['usage', id] }) }));
vi.mock('@/integrations/tanstack-query/query-client', () => ({ prefetchRouteData: vi.fn() }));
vi.mock('@nibleaf/i18n/locale-state', () => ({ getLocale: () => 'en', subscribeLanguage: () => () => undefined }));

import { Route } from './billing';

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
const BillingPage = Route.options.component as unknown as ComponentType;
let root: ReturnType<typeof createRoot>;

beforeEach(() => {
  mocks.orgRole = 'owner';
  mocks.usage = {
    isPending: false,
    data: {
      plan: { key: 'pro' },
      meters: [],
      websites: [
        {
          projectId: 'p-docs',
          name: 'Developer docs',
          meters: [
            { key: 'published_page', quantity: '42' },
            { key: 'public_page_view', quantity: '1200' },
            { key: 'build', quantity: null, unavailableReason: 'metering_disabled' },
          ],
        },
        { projectId: 'p-api', name: 'API reference', meters: [{ key: 'published_page', quantity: '7' }] },
        { projectId: 'p-unnamed', meters: [] },
      ],
    },
  };
});
afterEach(async () => {
  await act(async () => root?.unmount());
  document.body.replaceChildren();
  vi.clearAllMocks();
});

async function render() {
  const host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root.render(<BillingPage />));
  return host;
}
const breakdownRows = (host: HTMLElement) => [...host.querySelectorAll<HTMLElement>('section[aria-labelledby="breakdown-title"] tbody tr')];

describe('organization Usage & billing page', () => {
  it('a Member gets AdminRequired and usage is never requested', async () => {
    mocks.orgRole = 'member';
    const host = await render();
    expect(host.textContent).toContain('organization.adminRequired.title');
    expect(host.querySelector('[data-testid="usage-overview"]')).toBeNull();
    expect(mocks.usageFor).toHaveBeenCalledWith(undefined);
  });

  it.each(['owner', 'admin'] as const)('%s sees the org totals and a per-website breakdown with names', async (role) => {
    mocks.orgRole = role;
    const host = await render();
    expect(mocks.usageFor).toHaveBeenCalledWith('org-1');
    expect(host.querySelector<HTMLElement>('[data-testid="usage-overview"]')?.dataset.plan).toBe('pro');
    const rows = breakdownRows(host);
    expect(rows).toHaveLength(3);
    const first = [...(rows[0]?.querySelectorAll('td') ?? [])].map((cell) => cell.textContent);
    expect(first[0]).toBe('Developer docs');
    expect(rows[0]?.querySelector('a')?.getAttribute('href')).toBe('/app/projects/p-docs');
    // published pages, page views, storage (missing), builds (null): a missing number says why.
    expect(first.slice(1)).toEqual(['42', '1,200', '—settings.usage.unknownExplanation', '—reason:metering_disabled']);
    expect(rows[0]?.querySelectorAll('td')[4]?.querySelector('[title]')?.getAttribute('title')).toBe('reason:metering_disabled');
    expect(rows[1]?.querySelector('td')?.textContent).toBe('API reference');
    // A website without a name falls back to its id.
    expect(rows[2]?.querySelector('td')?.textContent).toBe('p-unnamed');
    expect(host.textContent).not.toContain('organization.billing.noWebsites');
  });

  it('says so when the organization has no websites', async () => {
    mocks.usage = { isPending: false, data: { meters: [], websites: [] } };
    const host = await render();
    expect(breakdownRows(host)).toHaveLength(0);
    expect(host.textContent).toContain('organization.billing.noWebsites');
  });

  it('shows a retryable error when usage fails', async () => {
    const refetch = vi.fn();
    mocks.usage = { isPending: false, isError: true, error: new Error('boom'), refetch };
    const host = await render();
    await act(async () => host.querySelector<HTMLButtonElement>('[role="alert"] button')?.click());
    expect(refetch).toHaveBeenCalledOnce();
    expect(host.querySelector('section[aria-labelledby="breakdown-title"]')).toBeNull();
  });
});
