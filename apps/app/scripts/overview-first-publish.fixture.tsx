// Actual Overview, editor and domain components; the capture script supplies
// fictional HTTP responses. No real account, publish, or DNS provider is used.
import { Button } from '@nibleaf/design-system/components/ui/button';
import { setLanguage } from '@nibleaf/i18n/locale-state';
import { useT } from '@nibleaf/i18n/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { createRootRoute, createRoute, createRouter, Link, Outlet, RouterProvider } from '@tanstack/react-router';
import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Toaster } from 'sonner';
import { TiptapEditor } from '../src/components/editor/tiptap-editor';
import { DomainSection } from '../src/components/project-settings/domain-section';
import { usePage, useProject, useUpdatePage } from '../src/hooks/api';
import { createQueryClient } from '../src/integrations/tanstack-query/query-client';
import { Route as overview } from '../src/routes/app/projects/$projectId/index';

const locale = new URLSearchParams(location.search).get('locale') === 'ar' ? 'ar' : 'en';
await setLanguage(locale);
document.documentElement.dir = locale === 'ar' ? 'rtl' : 'ltr';
document.documentElement.lang = locale;
const projectId = 'checklist-journey';
const queryClient = createQueryClient();
const overviewPath = '/app/projects/$projectId/';

function Shell() {
  const t = useT();
  return (
    <main className="min-h-dvh bg-background text-foreground">
      <header className="flex items-center gap-6 border-border border-b px-6 py-3">
        <span className="font-semibold">nibleaf</span>
        <Link className="text-sm underline" params={{ projectId }} to={overviewPath}>
          {t('overview.title')}
        </Link>
      </header>
      <Outlet />
      <Toaster dir={locale === 'ar' ? 'rtl' : 'ltr'} />
    </main>
  );
}

function EditorJourney() {
  const { data: page } = usePage(projectId, 'welcome');
  return page ? <EditablePage initial={page.content} /> : null;
}

function EditablePage({ initial }: { initial: string }) {
  const t = useT();
  const [content, setContent] = useState(initial);
  const update = useUpdatePage(projectId);
  return (
    <div className="mx-auto max-w-4xl p-6">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="font-semibold text-xl">{t('overview.nudge.step1')}</h1>
        <Button nativeButton={false} render={<Link params={{ projectId }} to={overviewPath} />} variant="outline">
          {t('overview.title')}
        </Button>
      </div>
      <TiptapEditor
        dir={locale === 'ar' ? 'rtl' : 'ltr'}
        lang={locale}
        onChange={(next) => {
          setContent(next);
          update.mutate({ pageId: 'welcome', body: { content: next } });
        }}
        value={content}
        variant="wysiwyg"
      />
    </div>
  );
}

function DomainJourney() {
  const { data: project } = useProject(projectId);
  return project ? (
    <div className="p-6">
      <DomainSection project={project} />
    </div>
  ) : null;
}

const root = createRootRoute({ component: Shell });
// The generated file-route types bind this route to the production site layout;
// the isolated fixture mounts that same component directly under its own root.
const overviewRoute = overview.update({ getParentRoute: () => root, path: '/app/projects/$projectId/' } as never);
const editor = createRoute({ getParentRoute: () => root, path: '/app/projects/$projectId/editor', component: EditorJourney });
const settings = createRoute({ getParentRoute: () => root, path: '/app/projects/$projectId/settings', component: DomainJourney });
const router = createRouter({ routeTree: root.addChildren([overviewRoute, editor, settings]), context: { queryClient } });
const element = document.getElementById('root');
if (!element) throw new Error('Missing fixture root');
createRoot(element).render(
  <QueryClientProvider client={queryClient}>
    <RouterProvider router={router} />
  </QueryClientProvider>,
);
