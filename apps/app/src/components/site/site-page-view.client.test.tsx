// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import type { SitePage } from '@/hooks/api/types';
import { SitePageView } from './site-page-view';

const setAlternates = vi.fn();
vi.mock('@/components/site/page-alternates-context', () => ({ useSitePageAlternates: () => ({ setAlternates }) }));
vi.mock('@/providers/site-analytics-provider', () => ({ useSiteAnalytics: () => ({ track: vi.fn() }) }));
vi.mock('@/components/markdown', () => ({ Markdown: () => null }));
vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);

const data = (overrides: Partial<SitePage> = {}): SitePage => ({
  project: {
    id: 'project-1',
    name: 'Example docs',
    slug: 'example',
    description: null,
    config: { visibility: 'public', addons: { feedback: false, editSuggestions: false, issueLinks: false } },
    primaryDomain: null,
  },
  page: {
    id: 'page-1',
    createdAt: '2026-09-03T00:00:00.000Z',
    updatedAt: '2026-09-03T00:00:00.000Z',
    title: 'Start',
    description: 'A public page.',
    excerpt: 'A public page.',
    icon: null,
    path: 'start',
    content: 'Public body.',
    headings: [],
    config: { mode: 'center' },
  },
  activeLanguage: 'en',
  activeVersion: 'main',
  versions: [{ id: 'version-1', name: 'Main', slug: 'main', isDefault: true }],
  languageConfig: null,
  languages: [
    { code: 'en', isDefault: true, path: 'start' },
    { code: 'ar', isDefault: false, path: 'start' },
  ],
  breadcrumbs: [{ title: 'Start', path: 'start' }],
  prev: null,
  next: null,
  ...overrides,
});

it.each(['page', 'language', 'version'])('resets reader feedback and URL when %s changes', async (change) => {
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  const initial = data();
  initial.project.config = { addons: { feedback: true, editUrl: 'https://example.test/edit?url={url}' } };
  window.history.replaceState(null, '', '/sites/project-1/start');
  await act(async () => root.render(<SitePageView data={initial} projectId="project-1" />));
  const initialFeedback = container.querySelector('button');
  if (!initialFeedback) throw new Error('Missing feedback button');
  await act(async () => initialFeedback.click());
  expect(initialFeedback.isConnected).toBe(false);
  const next = {
    ...initial,
    page: { ...initial.page, path: change === 'page' ? 'next' : 'start' },
    activeLanguage: change === 'language' ? 'ar' : 'en',
    activeVersion: change === 'version' ? 'v2' : 'main',
  };
  const url = `/sites/project-1/${change === 'version' ? 'v2/' : ''}${next.page.path}${change === 'language' ? '?lang=ar' : ''}`;
  window.history.replaceState(null, '', url);
  await act(async () => root.render(<SitePageView data={next} projectId="project-1" />));
  expect(container.querySelector('button')).not.toBeNull();
  const edit = container.querySelector<HTMLAnchorElement>('a[target="_blank"]');
  if (!edit) throw new Error('Missing edit link');
  expect(new URL(edit.href).searchParams.get('url')).toBe(window.location.href);
  await act(async () => root.unmount());
  container.remove();
});
