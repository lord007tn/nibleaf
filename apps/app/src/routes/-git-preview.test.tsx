// @vitest-environment jsdom
import type { SiteSnapshot, SnapshotPage } from '@nibleaf/shared/site';
import { act, type ComponentType } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';

vi.mock('@/functions/site', () => ({ getGitPreviewFn: vi.fn() }));
vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);

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
