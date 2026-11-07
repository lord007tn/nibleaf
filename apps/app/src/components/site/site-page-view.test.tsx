import { PassThrough } from 'node:stream';
import type { ReactNode } from 'react';
import { renderToPipeableStream, renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, onTestFinished, vi } from 'vitest';
import type { SitePage } from '@/hooks/api/types';
import { DOCUMENTATION_THEME_TEMPLATES } from './documentation-theme-provider';
import { SitePageView } from './site-page-view';
import { MobileTableOfContents, selectActiveHeading, TableOfContents } from './toc';

vi.mock('@/components/site/page-alternates-context', () => ({ useSitePageAlternates: () => ({ setAlternates: vi.fn() }) }));
vi.mock('@/providers/site-analytics-provider', () => ({ useSiteAnalytics: () => ({ track: vi.fn() }) }));

// The production reader streams Suspense content; wait for the full HTML to
// assert that the deferred renderer preserves article text and body links.
const renderCompleteHtml = (node: ReactNode): Promise<string> =>
  new Promise((resolve, reject) => {
    const output = new PassThrough();
    let html = '';
    output.on('data', (chunk) => {
      html += chunk.toString();
    });
    output.on('end', () => resolve(html));
    output.on('error', reject);
    const { pipe } = renderToPipeableStream(node, { onAllReady: () => pipe(output), onError: reject });
  });

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

describe('published page presentation', () => {
  it.each(['en', 'ar'])(
    'uses clean navigation and body links for the configured default %s language',
    async (code) => {
      const fixture = data({
        activeLanguage: code,
        languages: [{ code, isDefault: true, path: 'start' }],
        breadcrumbs: [
          { title: 'Parent', path: 'parent' },
          { title: 'Start', path: 'start' },
        ],
        page: { ...data().page, content: '[Sibling](/sibling#setup)\n\n[Explicit](/other?lang=fr)' },
        next: { title: 'Next', path: 'next' },
      });
      const html = await renderCompleteHtml(<SitePageView data={fixture} lang={code} projectId="project-1" />);
      expect(html).toContain('href="/sites/project-1/sibling#setup"');
      expect(html).toContain('href="/sites/project-1/parent"');
      expect(html).toContain('href="/sites/project-1/next"');
      expect(html).toContain('href="/sites/project-1/other?lang=fr"');
      expect(html).not.toContain(`?lang=${code}`);
    },
    // The first deferred render also compiles the Markdown dependency graph.
    30_000,
  );

  it('keeps a non-default language and version on generated reader links', async () => {
    const fixture = data({
      activeLanguage: 'ar',
      activeVersion: 'v2',
      versions: [{ id: 'v2', name: 'V2', slug: 'v2', isDefault: false }],
      page: { ...data().page, content: '[Sibling](/sibling#setup)' },
      next: { title: 'Next', path: 'next' },
    });
    const html = await renderCompleteHtml(<SitePageView data={fixture} lang="ar" projectId="project-1" />);
    expect(html).toContain('href="/sites/project-1/v2/sibling?lang=ar#setup"');
    expect(html).toContain('href="/sites/project-1/v2/next?lang=ar"');
  });
  it('reads Arabic article details grammatically, with a UTC date and a breadcrumb landmark', () => {
    // CI runs in UTC; a Riyadh clock (UTC+3) is where a local-time date shows the next day.
    vi.stubEnv('TZ', 'Asia/Riyadh');
    onTestFinished(() => vi.unstubAllEnvs());
    const words = Array.from({ length: 5 * 220 }, () => 'كلمة').join(' ');
    const fixture = data({
      activeLanguage: 'ar',
      breadcrumbs: [
        { title: 'Parent', path: 'parent' },
        { title: 'Start', path: 'start' },
      ],
      // 22:30 UTC is the next day in Riyadh; server and browser must agree on 3 September.
      page: { ...data().page, content: `${words}\n\n![One](/one.png)\n\n![Two](/two.png)`, updatedAt: '2026-09-03T22:30:00.000Z' },
    });
    const html = renderToStaticMarkup(<SitePageView data={fixture} lang="ar" projectId="project-1" />);
    expect(html).toContain('5 دقائق للقراءة');
    expect(html).toContain('لقطتا شاشة');
    expect(html).toContain('<time dateTime="2026-09-03T22:30:00.000Z">');
    expect(html).toContain(
      new Intl.DateTimeFormat('ar-u-nu-latn', { dateStyle: 'medium', timeZone: 'UTC' }).format(new Date('2026-09-03T22:30:00.000Z')),
    );
    expect(html).toMatch(/<nav class="mb-3" aria-label="مسار التنقّل"><ol[^>]*><li[^>]*><a href="\/sites\/project-1\/parent\?lang=ar"/);
  });

  it('excludes literal image examples from article screenshot counts but counts prose images', () => {
    const examples = ['````mdx', '<img src="/literal.png" />', '```', '![Example](/literal.png)', '````', '`<img src="/inline.png" />`'].join('\n');
    const render = (content: string) =>
      renderToStaticMarkup(<SitePageView data={data({ page: { ...data().page, content } })} projectId="project-1" />);
    expect(render(examples)).not.toContain('screenshot');
    expect(render(`${examples}\n![Actual](/actual.png)`)).toContain('screenshot');
    expect(render(`${examples}\n![Actual](/actual.png)`)).not.toContain('screenshots');
  });

  it('counts a light/dark image pair as one screenshot', () => {
    const pair = [
      '<Frame>',
      '  <img src="/light.png" alt="Dashboard" className="block dark:hidden" />',
      '  <img src="/dark.png" alt="Dashboard" className="hidden dark:block" />',
      '</Frame>',
    ].join('\n');
    const render = (content: string) =>
      renderToStaticMarkup(<SitePageView data={data({ page: { ...data().page, content } })} projectId="project-1" />).replaceAll('<!-- -->', '');
    expect(render(pair)).toMatch(/>\s*1 screenshot</);
    expect(render(`${pair}\n![Settings](/settings.png)`)).toMatch(/>\s*2 screenshots</);
    // The JSX expression form of the class list counts the same way.
    expect(render(pair.replace('className="hidden dark:block"', 'className={"hidden dark:block"}'))).toMatch(/>\s*1 screenshot</);
  });

  it.each(['en', 'ar'])('shows public %s content without Markdown source controls', async (language) => {
    const html = await renderCompleteHtml(<SitePageView data={data({ activeLanguage: language })} lang={language} projectId="project-1" />);
    expect(html).toContain('Public body.');
    expect(html).not.toContain('type="text/markdown"');
    expect(html).not.toMatch(/View Markdown|Copy Markdown|عرض Markdown|نسخ Markdown/);
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

describe('reader layout ergonomics', () => {
  it.each(['center', 'wide', 'default'] as const)('retains the themed shell for %s pages without an outline', (mode) => {
    const html = renderToStaticMarkup(<SitePageView data={data({ page: { ...data().page, config: { mode } } })} projectId="project-1" />);
    expect(html).toContain('data-documentation-layout="harbor-reference-page"');
    expect(html).not.toContain('data-theme-region="toc"');
  });
  it.each(Object.values(DOCUMENTATION_THEME_TEMPLATES))('retains $id padding without reserving an outline column', (template) => {
    const html = renderToStaticMarkup(template.PageLayout({ article: <article>Body</article> }));
    expect(html).toContain('data-theme-region="page-shell"');
    expect(html).toContain('Body');
    expect(html).not.toContain('data-theme-region="toc"');
    expect(html).not.toContain('xl:grid-cols-');
  });
  it('renders a collapsed mobile outline and the Signal styling hooks with a named landmark', () => {
    const headings = [{ id: 'refunds', text: 'Refunds', depth: 2 }];
    const html = renderToStaticMarkup(<MobileTableOfContents headings={headings} label="On this page" />);
    expect(html).toContain('<details');
    expect(html).not.toContain(' open=');
    expect(html).toContain('min-h-11');
    expect(html).toContain('aria-label="On this page"');
    const desktop = renderToStaticMarkup(<TableOfContents headings={headings} label="On this page" />);
    for (const hook of [
      'data-theme-component="toc"',
      'data-theme-region="toc-list"',
      'data-theme-region="toc-label"',
      'data-theme-region="toc-link"',
    ])
      expect(desktop).toContain(hook);
  });
  it.each(['en', 'ar'])('renders visible localized pager labels for %s', (language) => {
    const html = renderToStaticMarkup(
      <SitePageView
        data={data({ activeLanguage: language, prev: { title: 'Earlier title', path: 'earlier' }, next: { title: 'Later title', path: 'later' } })}
        projectId="project-1"
      />,
    );
    expect(html).toContain(language === 'ar' ? 'السابق' : 'Previous');
    expect(html).toContain(language === 'ar' ? 'التالي' : 'Next');
    expect(html).toContain('line-clamp-2');
    expect(html).toContain('min-h-11');
  });
  it('selects from all heading positions, supports reverse scrolling and forces the final heading at the end', () => {
    const headings = [
      { id: 'start', top: 100 },
      { id: 'payment', top: 600 },
      { id: 'refunds', top: 1100 },
    ];
    expect(selectActiveHeading(headings, 700, false)).toBe('payment');
    expect(selectActiveHeading(headings, 300, false)).toBe('start');
    expect(selectActiveHeading(headings, 800, true)).toBe('refunds');
    expect(selectActiveHeading(headings, 1200, false)).toBe('refunds');
    expect(selectActiveHeading([], 100, true)).toBe('');
  });
});
