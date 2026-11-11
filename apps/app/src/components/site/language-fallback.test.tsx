// @vitest-environment jsdom
import { PassThrough } from 'node:stream';
import { act, type ReactNode } from 'react';
import { hydrateRoot, type Root } from 'react-dom/client';
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

describe('reader text formatted on the server', () => {
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
