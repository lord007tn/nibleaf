// @vitest-environment jsdom
import type { SiteSnapshot, SnapshotPage } from '@nibleaf/shared/site';
import { act, type ComponentType } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';

vi.mock('@/functions/site', () => ({ getGitPreviewFn: vi.fn() }));
vi.mock('@nibleaf/i18n/react', () => ({ useLocale: () => ({ locale: 'en', t: (key: string) => key }) }));
vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);

import { getGitPreviewFn } from '@/functions/site';
import { ApiResponseError } from '@/hooks/api/client-helpers';
import { Route } from './git-preview.$token';

const page = (id: string, path: string, content: string, versionId = 'branch_next'): SnapshotPage => ({
  id,
  parentId: null,
  versionId,
  updatedAt: '2026-11-01T00:00:00.000Z',
  languageCode: 'en',
  kind: 'PAGE',
  title: id,
  slug: path,
  path,
  icon: null,
  description: null,
  content,
  config: null,
  translationKey: null,
  position: 0,
  hidden: false,
});

const snapshot = {
  project: {
    id: 'docs',
    name: 'Docs',
    slug: 'docs',
    description: null,
    icon: null,
    config: null,
    languages: [{ code: 'en', label: 'English', direction: 'LTR', isDefault: true, config: null }],
    versions: [
      { id: 'branch_main', name: 'main', slug: 'main', isDefault: true },
      { id: 'branch_next', name: 'next', slug: 'next', isDefault: false },
    ],
  },
  pages: [page('Intro', 'intro', 'See [the guide](/guides/setup).'), page('Setup', 'guides/setup', 'Setup body.')],
  generatedAt: '2026-11-01T00:00:00.000Z',
} as SiteSnapshot;

afterEach(() => document.body.replaceChildren());

it('builds preview links with the version slug and opens snapshot pages in place', async () => {
  window.scrollTo = vi.fn();
  // The preview lives on the app origin, not on a site's custom domain.
  window.history.replaceState(null, '', '/git-preview/token');
  vi.spyOn(Route, 'useLoaderData').mockReturnValue({ snapshot } as never);
  const Page = Route.options.component as ComponentType;
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  await act(async () => root.render(<Page />));
  await vi.waitFor(() => expect(container.querySelector('article a')).not.toBeNull());

  const link = container.querySelector<HTMLAnchorElement>('article a');
  // The slug, never the version ID, and no `?lang=` for the default language.
  expect(link?.getAttribute('href')).toBe('/sites/docs/next/guides/setup');
  await act(async () => link?.click());
  expect(container.querySelector('article h1')?.textContent).toBe('Setup');
  await act(async () => root.unmount());
});

it('keeps a link’s #fragment and scrolls to that heading once the page renders', async () => {
  window.scrollTo = vi.fn();
  const scrolled: string[] = [];
  Element.prototype.scrollIntoView = function (this: Element) {
    scrolled.push(this.id);
  };
  window.history.replaceState(null, '', '/git-preview/token');
  const withFragment = {
    ...snapshot,
    pages: [
      page('Intro', 'intro', 'See [installing](/guides/setup#install).'),
      page('Setup', 'guides/setup', 'Setup body.\n\n## Install\n\nRun it.'),
    ],
  } as SiteSnapshot;
  vi.spyOn(Route, 'useLoaderData').mockReturnValue({ snapshot: withFragment } as never);
  const Page = Route.options.component as ComponentType;
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  await act(async () => root.render(<Page />));
  await vi.waitFor(() => expect(container.querySelector('article a')).not.toBeNull());

  const link = container.querySelector<HTMLAnchorElement>('article a');
  expect(link?.getAttribute('href')).toBe('/sites/docs/next/guides/setup#install');
  await act(async () => link?.click());
  await vi.waitFor(() => expect(scrolled).toContain('install'));
  expect(window.scrollTo).not.toHaveBeenCalled();
  await act(async () => root.unmount());
});

it('opens the page in the language an authored ?lang= link names', async () => {
  window.scrollTo = vi.fn();
  window.history.replaceState(null, '', '/git-preview/token');
  const arabicSetup = { ...page('الإعداد', 'guides/setup', 'محتوى الإعداد.'), id: 'Setup-ar', languageCode: 'ar' };
  const bilingual = {
    ...snapshot,
    project: {
      ...snapshot.project,
      languages: [...snapshot.project.languages, { code: 'ar', label: 'العربية', direction: 'RTL', isDefault: false, config: null }],
    },
    pages: [page('Intro', 'intro', 'Read it [in Arabic](/guides/setup?lang=ar).'), page('Setup', 'guides/setup', 'Setup body.'), arabicSetup],
  } as SiteSnapshot;
  vi.spyOn(Route, 'useLoaderData').mockReturnValue({ snapshot: bilingual } as never);
  const Page = Route.options.component as ComponentType;
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  await act(async () => root.render(<Page />));
  await vi.waitFor(() => expect(container.querySelector('article a')).not.toBeNull());

  await act(async () => container.querySelector<HTMLAnchorElement>('article a')?.click());
  expect(container.querySelector('article h1')?.textContent).toBe('الإعداد');
  await act(async () => root.unmount());
});

it('opens a sidebar page at its top', async () => {
  window.scrollTo = vi.fn();
  window.history.replaceState(null, '', '/git-preview/token');
  vi.spyOn(Route, 'useLoaderData').mockReturnValue({ snapshot } as never);
  const Page = Route.options.component as ComponentType;
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  await act(async () => root.render(<Page />));

  const setup = [...container.querySelectorAll<HTMLButtonElement>('nav[aria-label="Preview pages"] button')].find(
    (button) => button.textContent === 'Setup',
  );
  await act(async () => setup?.click());
  expect(container.querySelector('article h1')?.textContent).toBe('Setup');
  expect(window.scrollTo).toHaveBeenCalledWith({ top: 0 });
  await act(async () => root.unmount());
});

it('shows a log-in screen instead of the drafts when the site is not public', async () => {
  const loader = Route.options.loader as (input: { params: { token: string } }) => Promise<unknown>;
  vi.mocked(getGitPreviewFn).mockRejectedValueOnce(
    new ApiResponseError('git preview not found', 404, 'database:not_found', undefined, undefined, undefined, undefined, { reason: 'private' }),
  );
  await expect(loader({ params: { token: 'token' } })).resolves.toEqual({ snapshot: null });
  // Any other failure (an unknown or expired link) stays an error.
  vi.mocked(getGitPreviewFn).mockRejectedValueOnce(new ApiResponseError('git preview not found', 404, 'database:not_found'));
  await expect(loader({ params: { token: 'token' } })).rejects.toBeInstanceOf(ApiResponseError);

  vi.spyOn(Route, 'useLoaderData').mockReturnValue({ snapshot: null } as never);
  vi.spyOn(Route, 'useParams').mockReturnValue({ token: 'token' } as never);
  const Page = Route.options.component as ComponentType;
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  await act(async () => root.render(<Page />));
  expect(container.querySelector('h1')?.textContent).toBe('preview.privateTitle');
  expect(container.querySelector('article')).toBeNull();
  const logIn = container.querySelector<HTMLAnchorElement>('a[href="/sign-in"]');
  logIn?.addEventListener('click', (event) => event.preventDefault());
  await act(async () => logIn?.click());
  expect(window.localStorage.getItem('nibleaf.pendingDestination')).toBe('/git-preview/token');
  await act(async () => root.unmount());
});
