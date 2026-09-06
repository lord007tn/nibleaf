import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { SitePage } from '@/hooks/api/types';
import { SitePageView } from './site-page-view';

vi.mock('@/components/site/page-alternates-context', () => ({ useSitePageAlternates: () => ({ setAlternates: vi.fn() }) }));
vi.mock('@/providers/site-analytics-provider', () => ({ useSiteAnalytics: () => ({ track: vi.fn() }) }));

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

describe('published page Markdown actions', () => {
  it('renders visible View and Copy actions for eligible public pages', () => {
    const html = renderToStaticMarkup(<SitePageView data={data()} projectId="project-1" />);
    expect(html).toContain('href="/sites/project-1/start.md"');
    expect(html).toContain('type="text/markdown"');
    expect(html).toContain('View Markdown');
    expect(html).toContain('Copy Markdown');
  });

  it('localizes actions and targets the resolved Arabic representation', () => {
    const html = renderToStaticMarkup(
      <SitePageView data={data({ activeLanguage: 'ar', languageConfig: { name: 'مثال' } })} lang="ar" projectId="project-1" />,
    );
    expect(html).toContain('/sites/project-1/start.md?lang=ar');
    expect(html).toContain('عرض Markdown');
    expect(html).toContain('نسخ Markdown');
  });

  it.each([
    { label: 'private', patch: { project: { ...data().project, config: { visibility: 'private' as const } } } },
    { label: 'noindex', patch: { page: { ...data().page, config: { seo: { noindex: true } } } } },
    { label: 'external canonical', patch: { page: { ...data().page, config: { seo: { canonicalUrl: 'https://origin.example/start' } } } } },
  ])('hides the controls for $label content', ({ patch }) => {
    const html = renderToStaticMarkup(<SitePageView data={data(patch)} projectId="project-1" />);
    expect(html).not.toContain('View Markdown');
    expect(html).not.toContain('Copy Markdown');
  });
});
