import { PassThrough } from 'node:stream';
import type { ReactNode } from 'react';
import { renderToPipeableStream, renderToStaticMarkup } from 'react-dom/server';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { Markdown } from '@/components/markdown';
import type { NavNode } from '@/hooks/api';
import type { SitePage } from '@/hooks/api/types';
import { contentLanguageAttributes } from './content-language';
import { SiteNav } from './site-nav';
import { SitePageView } from './site-page-view';
import { SiteReaderContext, type SiteReaderContextValue } from './site-reader-context';
import { TableOfContents } from './toc';

vi.mock('@/components/site/page-alternates-context', () => ({ useSitePageAlternates: () => ({ setAlternates: vi.fn() }) }));
vi.mock('@/providers/site-analytics-provider', () => ({ useSiteAnalytics: () => ({ track: vi.fn() }) }));

const renderHtml = (node: ReactNode): Promise<string> =>
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

const markdown = (content: string) => renderHtml(<Markdown content={content} site={{ projectId: 'docs', lang: 'en' }} />);

/** The opening tag of the first element of `tag` whose text starts with `text`. */
const openingTag = (html: string, tag: string, text: string): string | undefined =>
  new RegExp(`<${tag}\\b[^>]*>(?:<[^>]+>)*${text}`).exec(html)?.[0].match(new RegExp(`<${tag}\\b[^>]*>`))?.[0];

beforeAll(async () => {
  await import('@/components/markdown-rich');
}, 30_000);

describe('rendered Markdown blocks', () => {
  it('lays out each block by its own script', async () => {
    const html = await markdown(
      [
        '## خطوات الاسترداد',
        'افتح قائمة الحجوزات ثم اختر الحجز.',
        'Open the reservations list.',
        '- العنصر الأول من القائمة\n- The second item',
        '> اقتباس باللغة العربية',
        '| العمود | Column |\n| --- | --- |\n| قيمة | value |',
      ].join('\n\n'),
    );
    expect(openingTag(html, 'h2', 'خطوات')).toContain('dir="auto"');
    expect(openingTag(html, 'p', 'افتح')).toContain('dir="auto"');
    expect(openingTag(html, 'p', 'Open')).toContain('dir="auto"');
    expect(openingTag(html, 'li', 'العنصر')).toContain('dir="auto"');
    expect(openingTag(html, 'li', 'The second')).toContain('dir="auto"');
    expect(openingTag(html, 'td', 'قيمة')).toContain('dir="auto"');
    expect(openingTag(html, 'td', 'value')).toContain('dir="auto"');
    expect(openingTag(html, 'th', 'العمود')).toContain('dir="auto"');
    // A quote's rule sits on the side its own text starts.
    expect(html).toMatch(/<blockquote dir="rtl">/);
  });

  it('keeps technical Arabic right to left when a block opens with a Latin product name', async () => {
    const html = await markdown('Nibleaf يتيح لك إدارة التوثيق بسهولة.\n\n- API واجهة برمجة التطبيقات\n- Docker حاوية التشغيل');
    expect(openingTag(html, 'p', 'Nibleaf')).toContain('dir="rtl"');
    expect(openingTag(html, 'li', 'API')).toContain('dir="rtl"');
    expect(html).toMatch(/<ul dir="rtl">/);
  });

  it('keeps code blocks and inline code left to right', async () => {
    const html = await markdown('شغّل الأمر `pnpm install` أولاً.\n\n```bash\nexport NAME=قيمة\n```');
    expect(html).toMatch(/<pre\b[^>]*dir="ltr"/);
    expect(html).toMatch(/<code\b[^>]*dir="ltr"[^>]*>pnpm install<\/code>/);
    expect(html).toMatch(/<code\b[^>]*class="[^"]*language-bash[^"]*"[^>]*dir="ltr"|<code\b[^>]*dir="ltr"[^>]*class="[^"]*language-bash/);
    // Inline code is left out of the paragraph's own direction.
    expect(openingTag(html, 'p', 'شغّل')).toContain('dir="auto"');
  });

  it('puts a callout in the direction of its own text', async () => {
    const html = await markdown('> [!NOTE]\n> هذه ملاحظة مهمة للقارئ');
    expect(html).toMatch(/data-theme-component="callout"[^>]*dir="rtl"|dir="rtl"[^>]*data-theme-component="callout"/);
  });

  it('keeps an authored dir attribute', async () => {
    const html = await markdown('<p dir="ltr">مرحبا بالعالم</p>');
    expect(openingTag(html, 'p', 'مرحبا')).toContain('dir="ltr"');
  });

  it('renders the same attributes on every render, so hydration matches the server', async () => {
    const content = '# عنوان\n\nNibleaf يتيح لك.\n\n- one\n- اثنان ثلاثة';
    expect(await markdown(content)).toBe(await markdown(content));
  });
});

const page = (overrides: Partial<SitePage> = {}): SitePage => ({
  project: {
    id: 'docs',
    name: 'Jood Booking',
    slug: 'docs',
    description: null,
    config: { visibility: 'public', addons: { feedback: false, editSuggestions: false, issueLinks: false } },
    primaryDomain: null,
  },
  page: {
    id: 'page-1',
    createdAt: '2026-10-17T00:00:00.000Z',
    updatedAt: '2026-10-17T00:00:00.000Z',
    title: 'Add a new reservation',
    description: null,
    excerpt: '',
    icon: null,
    path: 'blog/add-new-reservation-2',
    content: 'Open the front desk calendar.',
    headings: [],
    config: null,
  },
  activeLanguage: 'en',
  activeVersion: 'main',
  versions: [{ id: 'v', name: 'main', slug: 'main', isDefault: true }],
  languageConfig: null,
  languages: [{ code: 'en', isDefault: true, path: 'blog/add-new-reservation-2' }],
  breadcrumbs: [
    { title: 'المدونة', path: 'blog' },
    { title: 'Add a new reservation', path: 'blog/add-new-reservation-2' },
  ],
  prev: null,
  next: null,
  ...overrides,
});

const arabicShell: SiteReaderContextValue = {
  lang: 'ar',
  homeHref: '/',
  languages: [
    { code: 'en', direction: 'LTR' },
    { code: 'ar', direction: 'RTL' },
  ],
};

const renderPage = (data: SitePage, shell: SiteReaderContextValue | null, lang?: string) =>
  renderHtml(
    <SiteReaderContext.Provider value={shell}>
      <SitePageView projectId="docs" lang={lang} data={data} />
    </SiteReaderContext.Provider>,
  );

describe('fallback article direction', () => {
  it('wraps an English fallback article inside an Arabic shell in its own language and direction', async () => {
    const html = await renderPage(page(), arabicShell, 'ar');
    expect(html).toMatch(/<article\b[^>]*lang="en"[^>]*dir="ltr"/);
    // The date is isolated, so it cannot reorder the meta line around it.
    expect(html).toMatch(/<bdi><time dateTime="2026-10-17T00:00:00.000Z">Oct 17, 2026<\/time><\/bdi>/);
    // Breadcrumbs and the title follow their own script.
    expect(html).toMatch(/<a\b[^>]*dir="auto"[^>]*>المدونة<\/a>/);
    expect(html).toMatch(/<h1\b[^>]*dir="auto"[^>]*>Add a new reservation<\/h1>/);
  });

  it('leaves an article in the shell language inheriting the document direction', async () => {
    const html = await renderPage(page({ activeLanguage: 'ar' }), arabicShell, 'ar');
    expect(html).toMatch(/<article\b(?![^>]*\blang=)(?![^>]*\bdir=)[^>]*>/);
  });

  it('carries a right-to-left fallback inside a left-to-right shell', () => {
    expect(contentLanguageAttributes('ar', { lang: 'en', languages: arabicShell.languages })).toEqual({ lang: 'ar', dir: 'rtl' });
    // A language the shell does not list falls back to its known direction.
    expect(contentLanguageAttributes('he', { lang: 'en' })).toEqual({ lang: 'he', dir: 'rtl' });
    expect(contentLanguageAttributes('fr', { lang: 'ar' })).toEqual({ lang: 'fr', dir: 'ltr' });
  });

  it('adds nothing without a shell language to compare against', () => {
    expect(contentLanguageAttributes('en', null)).toEqual({});
    expect(contentLanguageAttributes('en', { lang: undefined })).toEqual({});
    expect(contentLanguageAttributes(undefined, { lang: 'ar' })).toEqual({});
  });
});

describe('navigation labels', () => {
  const node = (id: string, title: string, kind: NavNode['kind'] = 'PAGE', children: NavNode[] = []): NavNode => ({
    id,
    kind,
    title,
    path: id,
    icon: null,
    tag: null,
    children,
  });

  it('isolate sidebar labels in their own direction', () => {
    const html = renderToStaticMarkup(
      <SiteNav
        nodes={[node('group', 'الأدلة', 'GROUP', [node('refund', 'خطوات إسترداد مبلغ على نظام PMS'), node('setup', 'Setup')])]}
        projectId="docs"
        currentPath="refund"
        toggleLabel="Toggle"
      />,
    );
    expect(html).toContain('<span class="truncate" dir="auto">الأدلة</span>');
    expect(html).toContain('<span class="truncate" dir="auto">خطوات إسترداد مبلغ على نظام PMS</span>');
    expect(html).toContain('<span class="truncate" dir="auto">Setup</span>');
  });

  it('keeps an Arabic label right to left when it opens with a Latin token', () => {
    const html = renderToStaticMarkup(
      <SiteNav nodes={[node('refund', 'PMS خطوات إسترداد مبلغ')]} projectId="docs" currentPath="" toggleLabel="Toggle" />,
    );
    expect(html).toContain('<span class="truncate" dir="rtl">PMS خطوات إسترداد مبلغ</span>');
  });

  it('isolate table of contents entries in their own direction', () => {
    const html = renderToStaticMarkup(
      <TableOfContents
        headings={[
          { id: 'a', text: 'خطوات الاسترداد', depth: 2 },
          { id: 'b', text: 'Refund steps', depth: 2 },
        ]}
        label="On this page"
      />,
    );
    expect(html).toContain('<span dir="auto">خطوات الاسترداد</span>');
    expect(html).toContain('<span dir="auto">Refund steps</span>');
  });
});
