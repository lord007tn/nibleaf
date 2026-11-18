// @vitest-environment jsdom
import type { Locale } from '@nibleaf/i18n/locales';
import { act, type ComponentType } from 'react';
import { hydrateRoot } from 'react-dom/client';
import { renderToString } from 'react-dom/server';
import { afterEach, expect, it, vi } from 'vitest';

const boundary = vi.hoisted(() => ({ server: true }));
// Model the package's conditional export: SSR reads all messages synchronously,
// while the hydration render can read only English and the downloaded locale.
vi.mock('@nibleaf/i18n/dashboard-catalog', async () => {
  const server = await import('../../../../packages/i18n/src/dashboard-catalog.server');
  const client = await import('../../../../packages/i18n/src/dashboard-catalog.client');
  return { ...server, dashboardMessage: (id: string, locale: Locale) => (boundary.server ? server : client).dashboardMessage(id, locale) };
});
vi.mock('@/functions/site', () => ({ getGitPreviewFn: vi.fn() }));
vi.mock('@/components/markdown', () => ({ Markdown: () => null }));

import { setLanguage } from '@nibleaf/i18n/locale-state';
import { useLocale } from '@nibleaf/i18n/react';
import { prepareDashboardLocale } from '../../../../packages/i18n/src/dashboard-catalog.client';
import { Route as PreviewRoute } from './git-preview.$token';

afterEach(() => {
  vi.restoreAllMocks();
  document.body.replaceChildren();
  document.documentElement.removeAttribute('data-locale');
  vi.unstubAllGlobals();
});

it.each(['en', 'ar'] as const)('hydrates the real private preview in %s through the server/client catalog boundary', async (locale) => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  document.documentElement.setAttribute('data-locale', locale);
  vi.spyOn(PreviewRoute, 'useLoaderData').mockReturnValue({ snapshot: null } as never);
  vi.spyOn(PreviewRoute, 'useParams').mockReturnValue({ token: 'fixture-preview' } as never);
  const Page = PreviewRoute.options.component as ComponentType;
  boundary.server = true;
  const container = document.createElement('div');
  container.innerHTML = renderToString(<Page />);
  document.body.append(container);
  const before = container.textContent;
  expect(before).toMatch(locale === 'ar' ? /[\u0600-\u06ff]/ : /private/i);
  expect(container.querySelector('[lang]')?.getAttribute('dir')).toBe(locale === 'ar' ? 'rtl' : 'ltr');
  await prepareDashboardLocale(locale);
  boundary.server = false;
  const errors: unknown[] = [];
  let root!: ReturnType<typeof hydrateRoot>;
  await act(async () => {
    root = hydrateRoot(container, <Page />, { onRecoverableError: (error) => errors.push(error) });
  });
  expect(errors).toEqual([]);
  expect(container.textContent).toBe(before);
  await act(async () => root.unmount());
});

function DashboardNavigation() {
  const { locale, t } = useLocale();
  return <nav lang={locale}>{t('common.cancel')}</nav>;
}

it('keeps documents without dashboard or reader preloads synchronous', async () => {
  window.history.replaceState(null, '', '/sign-in');
  const { getRouter } = await import('@/router');
  expect(getRouter().options.hydrate?.(undefined as never)).toBeUndefined();
});

it.each(['en', 'ar'] as const)('hydrates dashboard navigation in %s and switches without replacing the document', async (locale) => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  document.documentElement.setAttribute('data-locale', locale);
  boundary.server = true;
  const container = document.createElement('div');
  container.innerHTML = renderToString(<DashboardNavigation />);
  document.body.append(container);
  const before = container.textContent;
  expect(before).toBe(locale === 'ar' ? 'إلغاء' : 'Cancel');
  await prepareDashboardLocale(locale);
  boundary.server = false;
  const errors: unknown[] = [];
  let root!: ReturnType<typeof hydrateRoot>;
  await act(async () => {
    root = hydrateRoot(container, <DashboardNavigation />, { onRecoverableError: (error) => errors.push(error) });
  });
  expect(errors).toEqual([]);
  expect(container.textContent).toBe(before);
  const originalDocument = document.documentElement;
  const next = locale === 'en' ? 'ar' : 'en';
  await act(async () => setLanguage(next));
  expect(container.querySelector('nav')?.lang).toBe(next);
  expect(container.textContent).toBe(next === 'ar' ? 'إلغاء' : 'Cancel');
  expect(document.documentElement).toBe(originalDocument);
  await act(async () => root.unmount());
});
