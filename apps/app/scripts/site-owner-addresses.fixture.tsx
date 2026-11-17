// The actual Websites page and publish-check list, with fictional data from the
// capture script (tests/integration/site-owner-addresses). No real account,
// site or API is used.
import { setLanguage } from '@nibleaf/i18n/locale-state';
import { QueryClientProvider } from '@tanstack/react-query';
import { createRootRoute, createRoute, createRouter, Outlet, RouterProvider } from '@tanstack/react-router';
import { createRoot } from 'react-dom/client';
import { OrganizationContext } from '../src/components/organization/organization-context';
import { PublishChecks } from '../src/components/project/publish-checks';
import type { OrganizationDetail, PublishCheck } from '../src/hooks/api/types';
import { createQueryClient } from '../src/integrations/tanstack-query/query-client';
import { Route as websites } from '../src/routes/app/o/$orgSlug/websites';

const locale = new URLSearchParams(location.search).get('locale') === 'ar' ? 'ar' : 'en';
await setLanguage(locale);
document.documentElement.dir = locale === 'ar' ? 'rtl' : 'ltr';
document.documentElement.lang = locale;
const queryClient = createQueryClient();
const organization = (await (await fetch('/api/fixture/organization')).json()) as OrganizationDetail;
const checks = (await (await fetch('/api/fixture/checks')).json()) as PublishCheck[];

function Shell() {
  return (
    <OrganizationContext.Provider value={organization}>
      <main className="min-h-dvh bg-background text-foreground">
        <Outlet />
      </main>
    </OrganizationContext.Provider>
  );
}

function Checks() {
  return (
    <div className="mx-auto max-w-2xl p-6">
      <PublishChecks checks={checks} loading={false} onFix={() => undefined} projectId="handbook" />
    </div>
  );
}

const root = createRootRoute({ component: Shell });
// The generated file-route types bind this route to the organization layout; the
// fixture mounts the same component under its own root, with the organization
// the layout would provide.
const websitesRoute = websites.update({ getParentRoute: () => root, path: '/app/o/$orgSlug/websites' } as never);
const checksRoute = createRoute({ getParentRoute: () => root, path: '/checks', component: Checks });
const router = createRouter({ routeTree: root.addChildren([websitesRoute, checksRoute]), context: { queryClient } });
const element = document.getElementById('root');
if (!element) throw new Error('Missing fixture root');
createRoot(element).render(
  <QueryClientProvider client={queryClient}>
    <RouterProvider router={router} />
  </QueryClientProvider>,
);
