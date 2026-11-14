// @vitest-environment jsdom
import { PassThrough } from 'node:stream';
import { siteT } from '@nibleaf/i18n/site';
import { siteContentT } from '@nibleaf/i18n/site-content';
import { act, type ReactNode } from 'react';
import { createRoot, hydrateRoot, type Root } from 'react-dom/client';
import { renderToPipeableStream } from 'react-dom/server';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { SitePage } from '@/hooks/api/types';
import { readerTextFor } from '@/lib/reader-text';
import { chromeLanguageAttributes, languageEndonymOr } from './content-language';
import { SitePageView } from './site-page-view';
import { SiteReaderContext, type SiteReaderContextValue } from './site-reader-context';

vi.mock('@/components/site/page-alternates-context', () => ({ useSitePageAlternates: () => ({ setAlternates: vi.fn() }) }));
vi.mock('@/providers/site-analytics-provider', () => ({ useSiteAnalytics: () => ({ track: vi.fn() }) }));

/** The server HTML, parsed: what a reader gets before any script runs. */
const serverRender = (node: ReactNode): Promise<HTMLElement> =>
  new Promise((resolve, reject) => {
    const output = new PassThrough();
    let html = '';
    output.on('data', (chunk) => {
      html += chunk.toString();
    });
    output.on('end', () => {
      const container = document.createElement('div');
      container.innerHTML = html;
      resolve(container);
    });
    output.on('error', reject);
    const { pipe } = renderToPipeableStream(node, { onAllReady: () => pipe(output), onError: reject });
  });

const UPDATED_AT = '2026-10-17T00:00:00.000Z';

beforeAll(() => {
  // A reader on the platform host, so links keep the /sites/<project> prefix.
  window.history.replaceState(null, '', '/sites/docs/blog/add-new-reservation-2?lang=ar');
});

// The production page from the audit: an English blog post (five screenshots)
// that has no Arabic translation, opened with ?lang=ar.
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
    createdAt: UPDATED_AT,
    updatedAt: UPDATED_AT,
    title: 'Add a new reservation',
    description: null,
    excerpt: '',
    icon: null,
    path: 'blog/add-new-reservation-2',
    content: ['Open the front desk calendar.', ...Array.from({ length: 5 }, (_, index) => `![Step ${index + 1}](/step-${index + 1}.png)`)].join(
      '\n\n',
    ),
    headings: [],
    config: null,
  },
  activeLanguage: 'en',
  activeVersion: 'main',
  versions: [{ id: 'v', name: 'main', slug: 'main', isDefault: true }],
  languageConfig: null,
  languages: [
    { code: 'en', isDefault: true, path: 'blog/add-new-reservation-2' },
    { code: 'ar', isDefault: false, path: null },
  ],
  breadcrumbs: [{ title: 'Add a new reservation', path: 'blog/add-new-reservation-2' }],
  prev: null,
  next: null,
  ...overrides,
});

const shell = (lang: string): SiteReaderContextValue => ({
  lang,
  homeHref: '/',
  languages: [
    { code: 'en', direction: 'LTR', label: 'English' },
    { code: 'ar', direction: 'RTL', label: 'العربية' },
  ],
});

const renderPage = (data: SitePage, reader: SiteReaderContextValue) =>
  serverRender(
    <SiteReaderContext.Provider value={reader}>
      <SitePageView projectId="docs" lang={reader.lang} data={data} />
    </SiteReaderContext.Provider>,
  );

const isolatedNames = (element: Element) => [...element.querySelectorAll('bdi')].map((name) => name.textContent);

describe('language fallback notice', () => {
  it('tells an Arabic reader, in Arabic and right to left, that they are reading the English version', async () => {
    const view = await renderPage(page(), shell('ar'));
    const notes = view.querySelectorAll('[role="note"]');
    expect(notes).toHaveLength(1);
    const note = notes[0] as Element;
    expect(note.getAttribute('lang')).toBe('ar');
    expect(note.getAttribute('dir')).toBe('rtl');
    // Languages are named in the reader's language inside the sentence.
    expect(note.querySelector('p')?.textContent).toBe('هذه الصفحة غير متوفرة باللغة العربية بعد، لذا تقرأ نسختها باللغة الإنجليزية.');
    // Each language name keeps its own direction inside the sentence.
    expect(isolatedNames(note.querySelector('p') as Element)).toEqual(['العربية', 'الإنجليزية']);
    // It offers the page with the whole site in English (the default language's clean URL).
    const link = note.querySelector('a');
    // The link adds the language's own name, isolated, for a reader of that language.
    expect(link?.textContent).toBe('تصفّح الموقع باللغة الإنجليزية (English)');
    expect(link?.querySelector('bdi[lang="en"]')?.textContent).toBe('English');
    expect(link?.getAttribute('href')).toBe('/sites/docs/blog/add-new-reservation-2');
    expect(link?.getAttribute('hreflang')).toBe('en');
    // It sits at the top of the English article, which keeps its own language.
    const article = view.querySelector('article');
    expect(article?.getAttribute('lang')).toBe('en');
    expect(article?.firstElementChild).toBe(note);
  });

  it('tells an English reader of an Arabic-only page, in English and left to right', async () => {
    const data = page({
      activeLanguage: 'ar',
      languages: [
        { code: 'ar', isDefault: true, path: 'blog/add-new-reservation-2' },
        { code: 'en', isDefault: false, path: null },
      ],
    });
    const note = (await renderPage(data, shell('en'))).querySelector('[role="note"]');
    expect(note?.getAttribute('lang')).toBe('en');
    expect(note?.getAttribute('dir')).toBe('ltr');
    expect(note?.querySelector('p')?.textContent).toBe("This page isn't available in English yet. You're reading the Arabic version.");
    expect(note?.querySelector('a')?.textContent).toBe('View the site in Arabic (العربية)');
    expect(note?.querySelector('a')?.getAttribute('href')).toBe('/sites/docs/blog/add-new-reservation-2');
  });

  it('keeps a non-default fallback language and the version on its link', async () => {
    const data = page({
      activeLanguage: 'ar',
      activeVersion: 'next',
      versions: [
        { id: 'v', name: 'main', slug: 'main', isDefault: true },
        { id: 'n', name: 'next', slug: 'next', isDefault: false },
      ],
    });
    const note = (
      await renderPage(data, { ...shell('fr'), languages: [...(shell('fr').languages ?? []), { code: 'fr', direction: 'LTR' }] })
    ).querySelector('[role="note"]');
    expect(note?.getAttribute('lang')).toBe('fr');
    expect(note?.querySelector('a')?.getAttribute('href')).toBe('/sites/docs/next/blog/add-new-reservation-2?lang=ar');
  });

  it.each([
    ['en', 'en'],
    ['ar', 'ar'],
  ])('shows nothing when the page is in the reader’s language (%s page, %s reader)', async (pageLanguage, readerLanguage) => {
    const view = await renderPage(page({ activeLanguage: pageLanguage }), shell(readerLanguage));
    expect(view.querySelector('[role="note"]')).toBeNull();
    expect(view.querySelector('article')?.hasAttribute('lang')).toBe(false);
  });

  it('names languages by their own names, falling back to the site label', () => {
    expect(languageEndonymOr('ar')).toBe('العربية');
    expect(languageEndonymOr('en')).toBe('English');
    expect(languageEndonymOr('not a tag', 'Klingon')).toBe('Klingon');
    // Valid but without locale data: Intl would silently answer in en-US ("Latin").
    expect(languageEndonymOr('la', 'Latina')).toBe('Latina');
  });
});

describe('article meta line on a fallback page', () => {
  it('reads in the reader’s language and direction around the English article', async () => {
    const view = await renderPage(page(), shell('ar'));
    const meta = view.querySelector('ul[aria-label]');
    expect(meta?.getAttribute('aria-label')).toBe('تفاصيل المقالة');
    expect(meta?.getAttribute('lang')).toBe('ar');
    expect(meta?.getAttribute('dir')).toBe('rtl');
    const items = [...(meta?.querySelectorAll('li') ?? [])].map((item) => item.textContent?.trim());
    const date = new Intl.DateTimeFormat('ar-u-nu-latn', { dateStyle: 'medium', timeZone: 'UTC' }).format(new Date(UPDATED_AT));
    expect(items).toEqual(['دقيقة واحدة للقراءة', '5 لقطات شاشة', `آخر تحديث ${date}`]);
    // The date stays isolated, so it cannot reorder the line around it.
    expect(meta?.querySelector('bdi > time')?.getAttribute('datetime')).toBe(UPDATED_AT);
  });

  it('inherits the document language on a real translation', async () => {
    const view = await renderPage(page({ activeLanguage: 'ar' }), shell('ar'));
    const meta = view.querySelector('ul[aria-label]');
    expect(meta?.getAttribute('aria-label')).toBe('تفاصيل المقالة');
    expect(meta?.hasAttribute('lang')).toBe(false);
    expect(meta?.hasAttribute('dir')).toBe(false);
  });

  it('gives chrome inside fallback content the shell’s language and direction', () => {
    expect(chromeLanguageAttributes('en', shell('ar'))).toEqual({ lang: 'ar', dir: 'rtl' });
    expect(chromeLanguageAttributes('ar', shell('en'))).toEqual({ lang: 'en', dir: 'ltr' });
    // A shell language the site doesn't list still gets its known direction.
    expect(chromeLanguageAttributes('en', { lang: 'he' })).toEqual({ lang: 'he', dir: 'rtl' });
    expect(chromeLanguageAttributes('ar', shell('ar'))).toEqual({});
    expect(chromeLanguageAttributes('en', null)).toEqual({});
  });
});

// Council (#474): a browser whose ICU words a date or a language name differently
// from the server's must not change what hydration renders. Both sides use
// injected locale data, so the test never depends on the runtime's own ICU.
const fakeIntl = (tag: string, { supports = true } = {}) => {
  const fake = Object.create(Intl) as typeof Intl;
  // Every entry point the reader text uses, on both sides: constructors,
  // supportedLocalesOf and resolvedOptions.
  const supportedLocalesOf = (locales: string | string[]) => (supports ? [locales].flat() : []);
  Object.assign(fake, {
    DisplayNames: class {
      static supportedLocalesOf = supportedLocalesOf;
      constructor(private readonly locales: string | string[]) {}
      of(code: string) {
        return `${tag} NAME ${code}`;
      }
      resolvedOptions() {
        return { locale: [this.locales].flat()[0] ?? 'en', type: 'language', style: 'long', fallback: 'none' };
      }
    },
    DateTimeFormat: class {
      static supportedLocalesOf = supportedLocalesOf;
      constructor(private readonly locales?: string | string[]) {}
      format() {
        return `${tag} DATE`;
      }
      resolvedOptions() {
        return { locale: [this.locales ?? 'en'].flat()[0], timeZone: 'UTC', calendar: 'gregory', numberingSystem: 'latn' };
      }
    },
  });
  return fake;
};

describe('everything around a fallback article follows the reader (#481)', () => {
  const ar = siteT('ar');
  const fallback = () =>
    page({
      page: {
        ...page().page,
        headings: [{ id: 'open', text: 'Open the calendar', depth: 2 }],
        config: { mode: 'default', tags: ['Hotels'] },
      },
      breadcrumbs: [
        { title: 'Reservations', path: 'reservations', section: true },
        { title: 'Front desk', path: 'front-desk' },
        { title: 'Add a new reservation', path: 'blog/add-new-reservation-2' },
      ],
      prev: { title: 'Find a guest', path: 'find-a-guest' },
      next: { title: 'Cancel a reservation', path: 'cancel-a-reservation' },
    });

  it('labels the outline, breadcrumbs, tags and pager in Arabic, right to left, around the English article', async () => {
    const view = await renderPage(fallback(), shell('ar'));
    const crumbs = view.querySelector(`nav[aria-label="${ar('breadcrumb')}"]`);
    expect(crumbs?.getAttribute('lang')).toBe('ar');
    expect(crumbs?.getAttribute('dir')).toBe('rtl');
    const tags = view.querySelector(`ul[aria-label="${ar('tags')}"]`);
    expect(tags?.getAttribute('lang')).toBe('ar');
    expect(tags?.querySelector('li')?.getAttribute('lang')).toBe('en');
    const outline = view.querySelector('[data-theme-region="mobile-toc"] > summary');
    expect(outline?.textContent).toBe(ar('onThisPage'));
    expect(outline?.getAttribute('lang')).toBe('ar');
    // Inside the mobile outline: the nav is named in Arabic and marked so; its headings stay English.
    const mobileNav = view.querySelector('[data-theme-region="mobile-toc"] nav');
    expect(mobileNav?.getAttribute('aria-label')).toBe(ar('onThisPage'));
    expect(mobileNav?.getAttribute('lang')).toBe('ar');
    expect(mobileNav?.getAttribute('dir')).toBe('rtl');
    expect(mobileNav?.querySelector('ul')?.getAttribute('lang')).toBe('en');
    expect(mobileNav?.querySelector('ul')?.getAttribute('dir')).toBe('ltr');
    const pager = view.querySelector('[data-theme-region="pager"]');
    expect(pager?.getAttribute('lang')).toBe('ar');
    expect(pager?.textContent).toContain(ar('previous'));
    expect(pager?.textContent).toContain(ar('next'));
    // Titles of pages keep their own language inside the Arabic chrome.
    expect([...(pager?.querySelectorAll('[lang="en"]') ?? [])].map((title) => title.textContent)).toEqual(['Find a guest', 'Cancel a reservation']);
    // The desktop outline: an Arabic label over the English headings.
    const desktop = view.querySelector('[data-theme-region="toc"] nav');
    expect(desktop?.getAttribute('aria-label')).toBe(ar('onThisPage'));
    expect(desktop?.querySelector('ul')?.getAttribute('lang')).toBe('en');
    expect(desktop?.querySelector('ul')?.getAttribute('dir')).toBe('ltr');
  });

  it('labels the page actions in Arabic, right to left, and copies the English page it shows', async () => {
    const fetchMock = vi.fn(async () => new Response('# Add a new reservation', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: vi.fn(async () => undefined) } });
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    try {
      await act(async () =>
        root.render(
          <SiteReaderContext.Provider value={shell('ar')}>
            <SitePageView projectId="docs" lang="ar" data={page()} />
          </SiteReaderContext.Provider>,
        ),
      );
      const actions = host.querySelector('[data-page-actions]');
      expect(actions?.getAttribute('lang')).toBe('ar');
      expect(actions?.getAttribute('dir')).toBe('rtl');
      const copy = host.querySelector<HTMLButtonElement>('[data-page-actions] button');
      expect(copy).not.toBeNull();
      await act(async () => copy?.click());
      // The Markdown twin of the English page shown, not ?lang=ar (which answers 404).
      expect(fetchMock).toHaveBeenCalledWith('/sites/docs/blog/add-new-reservation-2.md', expect.anything());
    } finally {
      act(() => root.unmount());
      host.remove();
      vi.unstubAllGlobals();
    }
  });

  it.each([
    ['a private site', 'private', null],
    ['a noindex page', 'public', { seo: { noindex: true } }],
  ] as const)('offers no page actions on %s, so nothing private is copied or sent to an AI', async (_case, visibility, pageConfig) => {
    const base = page();
    const data = page({
      project: { ...base.project, config: { ...base.project.config, visibility } },
      page: { ...base.page, config: pageConfig } as SitePage['page'],
    });
    const view = await renderPage(data, shell('en'));
    expect(view.querySelector('h1')).not.toBeNull();
    expect(view.querySelector('[data-page-actions]')).toBeNull();
  });

  it('keeps the reader in Arabic on the next page they open', async () => {
    const view = await renderPage(fallback(), shell('ar'));
    const hrefs = [...view.querySelectorAll(`nav[aria-label="${ar('breadcrumb')}"] a, [data-theme-region="pager"] a`)].map((link) =>
      link.getAttribute('href'),
    );
    expect(hrefs).toEqual(['/sites/docs/front-desk?lang=ar', '/sites/docs/find-a-guest?lang=ar', '/sites/docs/cancel-a-reservation?lang=ar']);
  });

  it('shows a section (group or category) in the breadcrumbs as text, not a link to its first page', async () => {
    const view = await renderPage(fallback(), shell('en'));
    const crumbs = view.querySelector('nav[aria-label] ol');
    expect([...(crumbs?.querySelectorAll('li') ?? [])].map((crumb) => crumb.textContent?.replace('/', '').trim())).toEqual([
      'Reservations',
      'Front desk',
    ]);
    expect([...(crumbs?.querySelectorAll('a') ?? [])].map((link) => link.textContent)).toEqual(['Front desk']);
  });

  it('marks labels the reader generates inside the article as Arabic, and leaves authored titles English', async () => {
    const content = [
      '<Expandable>\n\nNested fields.\n\n</Expandable>',
      '<Accordion title="Authored question">\n\nAnswer.\n\n</Accordion>',
      '<Tabs>\n<Tab>\n\nOne\n\n</Tab>\n<Tab title="Second">\n\nTwo\n\n</Tab>\n</Tabs>',
    ].join('\n\n');
    const data = page({ page: { ...page().page, content } });
    await (await import('@/lib/reader-hydration-modules')).loadArticleRenderer(content);
    const view = await renderPage(data, shell('ar'));
    const ar = siteContentT('ar');
    const generated = [...view.querySelectorAll('article [lang="ar"]')].map((label) => [label.textContent, label.getAttribute('dir')]);
    expect(generated).toEqual(
      expect.arrayContaining([
        [ar('showProperties'), 'rtl'],
        [`${ar('tab')} 1`, 'rtl'],
      ]),
    );
    // Authored titles are content: no reader language on them.
    for (const authored of ['Authored question', 'Second']) {
      const element = [...view.querySelectorAll('article button, article span')].find((node) => node.textContent === authored);
      expect(element?.closest('[lang]')?.getAttribute('lang'), authored).toBe('en');
    }
  }, 60_000);

  it('keeps links in the article in Arabic and labels its controls in Arabic', async () => {
    const content = ['See [the front desk](/front-desk).', '## Open the calendar', '```js\nopen();\n```'].join('\n\n');
    const data = page({ page: { ...page().page, content } });
    await (await import('@/lib/reader-hydration-modules')).loadArticleRenderer(content);
    const view = await renderPage(data, shell('ar'));
    expect(view.querySelector('article a[href*="front-desk"]')?.getAttribute('href')).toBe('/sites/docs/front-desk?lang=ar');
    const sectionLink = view.querySelector('button.reader-section-link');
    expect(sectionLink?.getAttribute('lang')).toBe('ar');
    expect(sectionLink?.getAttribute('aria-label')).toBe(siteContentT('ar')('copySectionLink'));
    expect(view.querySelector(`button[aria-label="${siteContentT('ar')('copyCode')}"]`)?.getAttribute('lang')).toBe('ar');
  }, 60_000);

  it('adds no language attributes when the article is in the reader’s language', async () => {
    const view = await renderPage(fallback(), shell('en'));
    for (const selector of [
      'nav[aria-label] ol',
      '[data-theme-region="pager"]',
      '[data-theme-region="toc"] ul',
      '[data-theme-region="mobile-toc"] > summary',
    ])
      expect(view.querySelector(selector)?.hasAttribute('lang'), selector).toBe(false);
    expect(view.querySelector('[data-theme-region="pager"] a')?.getAttribute('href')).toBe('/sites/docs/find-a-guest');
  });
});

describe('reader text formatted on the server', () => {
  // The article renderer's first import is cold (Markdown, highlighting) and, on
  // a loaded runner, took longer than a test's 5 s on its own. Load it once here,
  // outside the tests' time budget; each test's own load below is then cached.
  beforeAll(async () => {
    await (await import('@/lib/reader-hydration-modules')).loadArticleRenderer(page().page.content);
  }, 60_000);

  it.each([
    ['has locale data for the reader', true],
    ['has no locale data for the reader (labels are used)', false],
  ])('hydrates verbatim when the server %s and the browser formats differently', async (_, serverSupports) => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    // The server: its own locale data formats the reader text and renders the page.
    vi.stubGlobal('Intl', fakeIntl('SERVER', { supports: serverSupports }));
    const data = page({ readerText: readerTextFor('ar', UPDATED_AT, ['en', 'ar']) });
    const element = (
      <SiteReaderContext.Provider value={shell('ar')}>
        <SitePageView projectId="docs" lang="ar" data={data} />
      </SiteReaderContext.Provider>
    );
    // As the route loader does before rendering: the article renderer is loaded,
    // so the server HTML has the article body (in a jsdom "server" render the
    // article island doesn't wait for it, and how fast the import lands would
    // otherwise decide whether the body is in the snapshot).
    await (await import('@/lib/reader-hydration-modules')).loadArticleRenderer(data.page.content);
    const container = await serverRender(element);
    document.body.append(container);
    const serverText = container.textContent ?? '';
    expect(serverText).toContain('Open the front desk calendar.');
    expect(serverText).toContain('SERVER DATE');
    expect(container.querySelector('[role="note"]')?.textContent).toContain(serverSupports ? 'SERVER NAME en' : 'English');

    // The browser: different locale data entirely.
    vi.stubGlobal('Intl', fakeIntl('BROWSER'));
    const errors: unknown[] = [];
    let root: Root | undefined;
    try {
      await act(async () => {
        root = hydrateRoot(container, element, { onRecoverableError: (error) => errors.push(error) });
      });
      expect(errors).toEqual([]);
      const hydratedText = container.textContent ?? '';
      // Both full strings on a mismatch, so a CI failure says exactly what differs.
      expect(hydratedText, `server:   ${JSON.stringify(serverText)}\nhydrated: ${JSON.stringify(hydratedText)}`).toBe(serverText);
      expect(container.textContent).not.toMatch(/BROWSER/);
    } finally {
      await act(async () => root?.unmount());
      vi.unstubAllGlobals();
      container.remove();
    }
  });
});
