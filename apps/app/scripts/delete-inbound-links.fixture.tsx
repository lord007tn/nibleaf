import { Button } from '@nibleaf/design-system/components/ui/button';
import { ConfirmProvider, useConfirm } from '@nibleaf/design-system/components/ui/confirm';
import '@nibleaf/design-system/globals.css';
import { setLanguage } from '@nibleaf/i18n/locale-state';
import { useT } from '@nibleaf/i18n/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createMemoryHistory, createRootRoute, createRoute, createRouter, Outlet, RouterProvider } from '@tanstack/react-router';
import { createRoot } from 'react-dom/client';
import { DeletePageInboundLinks } from '../src/components/editor/delete-page-inbound-links';

const params = new URLSearchParams(location.search);
await setLanguage(params.get('locale') === 'ar' ? 'ar' : 'en');
const before = params.get('before') === '1';

function Fixture() {
  const t = useT();
  const confirm = useConfirm();
  return (
    <main className="mx-auto max-w-3xl space-y-6 p-8">
      <p className="text-muted-foreground text-sm">Nibleaf · AUTH-12 · UI fixture</p>
      <h1 className="text-2xl font-semibold">{t('editor.deletePage')}</h1>
      <p className="text-muted-foreground">{t('editor.deletePageConfirm', { title: 'Setup' })}</p>
      <Button
        variant="destructive"
        onClick={() =>
          void confirm({
            title: t('editor.deletePage'),
            description: t('editor.deletePageConfirm', { title: 'Setup' }),
            confirmLabel: t('editor.deletePage'),
            destructive: true,
            children: before ? undefined : <DeletePageInboundLinks projectId="fixture-site" pageId="setup" />,
          })
        }
      >
        {t('editor.deletePage')}
      </Button>
    </main>
  );
}

function Providers() {
  const t = useT();
  return (
    <QueryClientProvider client={client}>
      <ConfirmProvider labels={{ cancel: t('common.cancel') }}>
        <Outlet />
      </ConfirmProvider>
    </QueryClientProvider>
  );
}
const client = new QueryClient();
Object.assign(window, { refetchInboundLinks: () => client.refetchQueries({ queryKey: ['pages', 'fixture-site', 'setup', 'inbound-links'] }) });
const rootRoute = createRootRoute({ component: Providers });
const routeTree = rootRoute.addChildren([
  createRoute({ getParentRoute: () => rootRoute, path: '/', component: Fixture }),
  createRoute({ getParentRoute: () => rootRoute, path: '/app/projects/$projectId/editor', component: Fixture }),
]);
const router = createRouter({ routeTree, history: createMemoryHistory({ initialEntries: ['/'] }) });
const element = document.getElementById('root');
if (!element) throw new Error('Missing fixture root');
createRoot(element).render(<RouterProvider router={router} />);
