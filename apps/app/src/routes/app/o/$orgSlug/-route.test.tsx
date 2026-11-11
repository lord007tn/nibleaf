// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, type ComponentType, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type Detail = { id: string; slug: string; name: string; logo: null; orgRole: 'owner' | 'admin' | 'member'; canCreateWebsite: boolean };

const mocks = vi.hoisted(() => ({
  orgSlug: 'acme',
  pathname: '/app/o/acme/members',
  searchStr: '',
  navigate: vi.fn(),
  lostOrganization: vi.fn(),
  bySlug: vi.fn(),
  switcherOrganizations: [] as Array<{ slug: string; name: string }>,
  recordVisit: vi.fn(),
  layout: vi.fn(),
}));

vi.mock('@nibleaf/i18n/react', () => ({ useT: () => (key: string) => key }));
vi.mock('@tanstack/react-router', async () => {
  const { useCurrentOrganization } = await import('@/components/organization/organization-context');
  return {
    createFileRoute: () => (options: Record<string, unknown>) => ({ options, useParams: () => ({ orgSlug: mocks.orgSlug }) }),
    useNavigate: () => mocks.navigate,
    useRouterState: ({ select }: { select: (state: { location: { pathname: string; searchStr: string } }) => unknown }) =>
      select({ location: { pathname: mocks.pathname, searchStr: mocks.searchStr } }),
    Outlet() {
      const organization = useCurrentOrganization();
      return <p data-testid="outlet">{`${organization.name} (${organization.orgRole})`}</p>;
    },
  };
});
vi.mock('@/hooks/api/organization-query-options', () => ({
  organizationBySlugQueryOptions: (slug: string) => ({
    queryKey: ['organizations', 'by-slug', slug],
    queryFn: () => mocks.bySlug(slug),
    retry: false,
  }),
  switcherQueryOptions: () => ({ queryKey: ['me', 'switcher'] }),
}));
vi.mock('@/hooks/api', () => ({ useSwitcher: () => ({ data: { organizations: mocks.switcherOrganizations } }) }));
vi.mock('@/components/organization/use-access-loss', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/components/organization/use-access-loss')>()),
  useAccessLoss: () => ({ lostOrganization: mocks.lostOrganization, lostWebsite: vi.fn() }),
}));
vi.mock('@/components/not-found', () => ({ NotFound: () => <h1 data-testid="not-found">not found</h1> }));
vi.mock('@/hooks/use-record-visit', () => ({ useRecordVisitEffect: mocks.recordVisit }));
vi.mock('@/integrations/tanstack-query/query-client', () => ({ prefetchRouteData: vi.fn() }));
vi.mock('@/layouts/organization', () => ({
  OrganizationLayout: ({ orgSlug, organization, children }: { orgSlug: string; organization?: Detail; children: ReactNode }) => {
    mocks.layout({ orgSlug, organization });
    return <main data-org={organization?.slug ?? ''}>{children}</main>;
  },
}));

import { ApiResponseError } from '@/hooks/api/client-helpers';
import { Route } from './route';

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
const OrganizationRoute = Route.options.component as unknown as ComponentType;
let root: ReturnType<typeof createRoot>;
const detail = (slug: string, name = 'Acme Docs', orgRole: Detail['orgRole'] = 'admin'): Detail => ({
  id: 'org-1',
  slug,
  name,
  logo: null,
  orgRole,
  canCreateWebsite: orgRole !== 'member',
});

beforeEach(() => {
  mocks.orgSlug = 'acme';
  mocks.pathname = '/app/o/acme/members';
  mocks.searchStr = '';
  mocks.switcherOrganizations = [];
  mocks.bySlug.mockResolvedValue(detail('acme'));
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
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () =>
    root.render(
      <QueryClientProvider client={client}>
        <OrganizationRoute />
      </QueryClientProvider>,
    ),
  );
  await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
  return host;
}

describe('/app/o/$orgSlug route', () => {
  it('renders a skeleton while the org resolves, then the page inside the organization context', async () => {
    let resolve: (value: Detail) => void = () => undefined;
    mocks.bySlug.mockReturnValue(
      new Promise<Detail>((done) => {
        resolve = done;
      }),
    );
    const host = await render();
    expect(host.querySelector('[aria-busy="true"]')).not.toBeNull();
    expect(host.querySelector('[data-testid="outlet"]')).toBeNull();
    await act(async () => resolve(detail('acme')));
    await act(async () => new Promise((done) => setTimeout(done, 0)));
    expect(host.querySelector('[data-testid="outlet"]')?.textContent).toBe('Acme Docs (admin)');
    expect(host.querySelector('main')?.dataset.org).toBe('acme');
    expect(mocks.bySlug).toHaveBeenCalledWith('acme');
    expect(mocks.recordVisit).toHaveBeenLastCalledWith({ organizationId: 'org-1' });
    expect(mocks.navigate).not.toHaveBeenCalled();
  });

  it('redirects an old handle to the current one, keeping the rest of the path and the search', async () => {
    mocks.orgSlug = 'old-acme';
    mocks.pathname = '/app/o/old-acme/settings';
    mocks.searchStr = '?tab=general';
    mocks.bySlug.mockResolvedValue(detail('acme'));
    await render();
    expect(mocks.bySlug).toHaveBeenCalledWith('old-acme');
    expect(mocks.navigate).toHaveBeenCalledWith({ to: '/app/o/acme/settings?tab=general', replace: true });
  });

  it('a 404 for an org you had open sends you home with its cached name', async () => {
    mocks.switcherOrganizations = [{ slug: 'acme', name: 'Acme Docs' }];
    mocks.bySlug.mockRejectedValue(new ApiResponseError('Not found', 404));
    const host = await render();
    expect(mocks.lostOrganization).toHaveBeenCalledWith('Acme Docs');
    expect(host.querySelector('[data-testid="not-found"]')).toBeNull();
    expect(host.querySelector('[data-testid="outlet"]')).toBeNull();
    expect(mocks.layout).toHaveBeenLastCalledWith({ orgSlug: 'acme', organization: undefined });
  });

  it('a 404 with nothing cached renders the not-found page (unknown slug and non-member look alike)', async () => {
    mocks.bySlug.mockRejectedValue(new ApiResponseError('Not found', 404));
    const host = await render();
    expect(host.querySelector('[data-testid="not-found"]')).not.toBeNull();
    expect(mocks.lostOrganization).not.toHaveBeenCalled();
    expect(host.querySelector('main')).toBeNull();
  });

  it('another failure shows a retryable error instead of not-found', async () => {
    mocks.bySlug.mockRejectedValue(new ApiResponseError('Server error', 500));
    const host = await render();
    expect(host.querySelector('[role="alert"]')).not.toBeNull();
    expect(host.querySelector('[data-testid="not-found"]')).toBeNull();
    expect(mocks.lostOrganization).not.toHaveBeenCalled();
    mocks.bySlug.mockResolvedValue(detail('acme'));
    await act(async () => host.querySelector<HTMLButtonElement>('[role="alert"] button')?.click());
    await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
    expect(host.querySelector('[data-testid="outlet"]')?.textContent).toBe('Acme Docs (admin)');
  });

  it('sends the bare /app/o/$orgSlug to its Websites page', async () => {
    mocks.pathname = '/app/o/acme';
    await render();
    expect(mocks.navigate).toHaveBeenCalledWith({ to: '/app/o/$orgSlug/websites', params: { orgSlug: 'acme' }, replace: true });
  });

  it('re-checks membership when navigating inside the org, not when leaving it', async () => {
    await render();
    const calls = mocks.bySlug.mock.calls.length;
    mocks.pathname = '/app/o/acme/analytics';
    await act(async () =>
      root.render(
        <QueryClientProvider client={new QueryClient()}>
          <OrganizationRoute />
        </QueryClientProvider>,
      ),
    );
    await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
    expect(mocks.bySlug.mock.calls.length).toBeGreaterThan(calls);
  });
});
