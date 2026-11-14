// The actual organization and website routes (their not-found and load-failure
// states) and the Site Analytics layout and sections, with fictional data from
// the capture script (tests/integration/dash-unknown-shell). No real account,
// site or API is used.
import { setLanguage } from '@nibleaf/i18n/locale-state';
import { QueryClientProvider } from '@tanstack/react-query';
import { createRootRoute, createRoute, createRouter, Outlet, RouterProvider } from '@tanstack/react-router';
import { createRoot } from 'react-dom/client';
import { CommandPaletteProvider } from '../src/components/app/command-palette';
import { SwitcherProvider } from '../src/components/app/org-switcher/switcher-provider';
import { SkipToContent } from '../src/components/app/skip-to-content';
import { AppProviders } from '../src/components/app-providers';
import { createQueryClient } from '../src/integrations/tanstack-query/query-client';
import { Route as organization } from '../src/routes/app/o/$orgSlug/route';
import { Route as websites } from '../src/routes/app/o/$orgSlug/websites';
import { Route as analytics } from '../src/routes/app/projects/$projectId/analytics';
import { Route as analyticsOverview } from '../src/routes/app/projects/$projectId/analytics.index';
import { Route as analyticsPerformance } from '../src/routes/app/projects/$projectId/analytics.performance';
import { Route as overview } from '../src/routes/app/projects/$projectId/index';
import { Route as project } from '../src/routes/app/projects/$projectId/route';
import { ProjectProvider } from '../src/stores/active-project';

const params = new URLSearchParams(location.search);
const locale = params.get('locale') === 'ar' ? 'ar' : 'en';
await setLanguage(locale);
document.documentElement.dir = locale === 'ar' ? 'rtl' : 'ltr';
document.documentElement.lang = locale;
// What the design system's ThemeProvider does for a resolved theme.
const theme = params.get('theme') === 'dark' ? 'dark' : 'light';
document.documentElement.classList.add(theme);
document.documentElement.style.colorScheme = theme;
const queryClient = createQueryClient();
// What routes/app/route.tsx puts in the route context after its server session check.
const routeSession = await (await fetch('/api/auth/get-session')).json();

/** The signed-in dashboard shell from routes/app/route.tsx (AppGuard), without its server session check. */
function Shell() {
  return (
    <AppProviders>
      <div data-dashboard-shell="">
        <SkipToContent />
        <ProjectProvider>
          <SwitcherProvider>
            <CommandPaletteProvider>
              <Outlet />
            </CommandPaletteProvider>
          </SwitcherProvider>
        </ProjectProvider>
      </div>
    </AppProviders>
  );
}

const root = createRootRoute({ component: Outlet });
const app = createRoute({ getParentRoute: () => root, path: '/app', beforeLoad: () => ({ routeSession }), component: Shell });
// The generated file-route types bind these routes to the production tree; the
// fixture mounts the same routes under its own `/app` with the same ids.
const organizationRoute = organization.update({ getParentRoute: () => app, path: 'o/$orgSlug' } as never);
const websitesRoute = websites.update({ getParentRoute: () => organizationRoute, path: 'websites' } as never);
const projectRoute = project.update({ getParentRoute: () => app, path: 'projects/$projectId' } as never);
const overviewRoute = overview.update({ getParentRoute: () => projectRoute, path: '/' } as never);
const analyticsRoute = analytics.update({ getParentRoute: () => projectRoute, path: 'analytics' } as never);
const analyticsOverviewRoute = analyticsOverview.update({ getParentRoute: () => analyticsRoute, path: '/' } as never);
const analyticsPerformanceRoute = analyticsPerformance.update({ getParentRoute: () => analyticsRoute, path: 'performance' } as never);
const blank = createRoute({ getParentRoute: () => root, path: '/', component: () => null });
const routeTree = root.addChildren([
  blank,
  app.addChildren([
    organizationRoute.addChildren([websitesRoute]),
    projectRoute.addChildren([overviewRoute, analyticsRoute.addChildren([analyticsOverviewRoute, analyticsPerformanceRoute])]),
  ]),
]);
const router = createRouter({ routeTree, context: { queryClient } });
const element = document.getElementById('root');
if (!element) throw new Error('Missing fixture root');
createRoot(element).render(
  <QueryClientProvider client={queryClient}>
    <RouterProvider router={router} />
  </QueryClientProvider>,
);
