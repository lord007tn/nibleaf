// The actual theme settings section for a site whose brand accent fails AA as
// text (PUB-006). No network: the section only reads the project passed in, and
// nothing here saves (its import confirmation needs the ConfirmProvider). Built and captured by a local harness, like the other
// fixtures in this folder.
import { ConfirmProvider } from '@nibleaf/design-system/components/ui/confirm';
import { setLanguage } from '@nibleaf/i18n/locale-state';
import { QueryClientProvider } from '@tanstack/react-query';
import { createRoot } from 'react-dom/client';
import { ThemeSettings as ThemeSection } from '../src/features/site-theme/components/theme-settings';
import type { Project } from '../src/hooks/api';
import { createQueryClient } from '../src/integrations/tanstack-query/query-client';

const params = new URLSearchParams(location.search);
const locale = params.get('locale') === 'ar' ? 'ar' : 'en';
await setLanguage(locale);
document.documentElement.dir = locale === 'ar' ? 'rtl' : 'ltr';
document.documentElement.lang = locale;
if (params.get('theme') === 'dark') document.documentElement.classList.add('dark');

const project: Project = {
  id: 'brand-accent',
  organizationId: 'org',
  name: 'Brand docs',
  slug: 'brand-docs',
  description: null,
  icon: null,
  config: { theme: { version: 1, preset: 'harbor', colors: { light: { accent: '#b96a3d' } } } } as Project['config'],
  createdAt: '2026-11-13T00:00:00.000Z',
  updatedAt: '2026-11-13T00:00:00.000Z',
};

createRoot(document.getElementById('root') as HTMLElement).render(
  <QueryClientProvider client={createQueryClient()}>
    <ConfirmProvider>
      <main className="mx-auto max-w-5xl bg-background p-6 text-foreground">
        <ThemeSection project={project} />
      </main>
    </ConfirmProvider>
  </QueryClientProvider>,
);
