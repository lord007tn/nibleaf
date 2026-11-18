import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createMemoryHistory, createRootRoute, createRouter, RouterProvider } from '@tanstack/react-router';
import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { SiteSearch } from '../../src/components/site/site-search';
import './harness.css';
import { observe } from './observe';

const language = new URLSearchParams(location.search).get('lang') === 'ar' ? 'ar' : 'en';
document.documentElement.lang = language;
document.documentElement.dir = language === 'ar' ? 'rtl' : 'ltr';

function Harness() {
  const [open, setOpen] = useState(false);
  Object.assign(window, { readerExit: { observe, open: () => setOpen(true) } });
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        {language === 'ar' ? 'افتح البحث' : 'Open search'}
      </button>
      <SiteSearch
        projectId="preview-harbor"
        lang={language}
        direction={language === 'ar' ? 'rtl' : 'ltr'}
        open={open}
        onOpenChange={setOpen}
        maxResults={30}
      />
    </>
  );
}

const route = createRootRoute({ component: Harness });
const router = createRouter({ routeTree: route, history: createMemoryHistory({ initialEntries: ['/'] }) });
const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
const root = document.getElementById('root');
if (!root) throw new Error('Missing harness root');
createRoot(root).render(
  <QueryClientProvider client={queryClient}>
    <RouterProvider router={router} />
  </QueryClientProvider>,
);
