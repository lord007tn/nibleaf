// The actual signed-in dashboard shell around four dense screens, for the
// per-locale captures of the translation PRs (tests/integration/dash-locale-screens):
// the website layout (ProjectLayout: header, Publish control, sidebar) around
// Site settings and Site analytics, and the organization layout around People.
// Fictional data comes from the capture script. No real account, site or API is used.

import { setLanguage } from '@nibleaf/i18n/locale-state';
import { INTERFACE_LOCALES, type Locale } from '@nibleaf/i18n/locales';
import { QueryClientProvider } from '@tanstack/react-query';
import { createRootRoute, createRoute, createRouter, Outlet, RouterProvider } from '@tanstack/react-router';
import { createRoot } from 'react-dom/client';
import { CommandPaletteProvider } from '../src/components/app/command-palette';
import { SwitcherProvider } from '../src/components/app/org-switcher/switcher-provider';
import { SkipToContent } from '../src/components/app/skip-to-content';
import { AppProviders } from '../src/components/app-providers';
import { createQueryClient } from '../src/integrations/tanstack-query/query-client';
import { Route as members } from '../src/routes/app/o/$orgSlug/members';
import { Route as organization } from '../src/routes/app/o/$orgSlug/route';
import { Route as analytics } from '../src/routes/app/projects/$projectId/analytics';
import { Route as analyticsOverview } from '../src/routes/app/projects/$projectId/analytics.index';
import { Route as project } from '../src/routes/app/projects/$projectId/route';
import { Route as settings } from '../src/routes/app/projects/$projectId/settings';
import { ProjectProvider } from '../src/stores/active-project';

const params = new URLSearchParams(location.search);
const requested = params.get('locale');
const locale: Locale = INTERFACE_LOCALES.find((item) => item.code === requested)?.code ?? 'en';
// As the language picker does: the catalog switches and <html lang dir> follows it.
await setLanguage(locale);
// What the design system's ThemeProvider does for a resolved light theme.
document.documentElement.classList.add('light');
document.documentElement.style.colorScheme = 'light';
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
// fixture mounts the same routes under its own `/app` with the same paths.
const projectRoute = project.update({ getParentRoute: () => app, path: 'projects/$projectId' } as never);
const settingsRoute = settings.update({ getParentRoute: () => projectRoute, path: 'settings' } as never);
const analyticsRoute = analytics.update({ getParentRoute: () => projectRoute, path: 'analytics' } as never);
const analyticsOverviewRoute = analyticsOverview.update({ getParentRoute: () => analyticsRoute, path: '/' } as never);
const organizationRoute = organization.update({ getParentRoute: () => app, path: 'o/$orgSlug' } as never);
const membersRoute = members.update({ getParentRoute: () => organizationRoute, path: 'members' } as never);
const blank = createRoute({ getParentRoute: () => root, path: '/', component: () => null });
const routeTree = root.addChildren([
  blank,
  app.addChildren([
    projectRoute.addChildren([settingsRoute, analyticsRoute.addChildren([analyticsOverviewRoute])]),
    organizationRoute.addChildren([membersRoute]),
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
