/** `/ar/pricing` and `/ar/self-hosting` (P2-MKT-002): Arabic pages on the English layouts and facts. */
import { readdirSync } from 'node:fs';
import { parseHTML } from 'linkedom';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { marketingFaqs } from '@/lib/marketing-faqs';
import { ArabicPricingPage } from './arabic-pricing-page';
import { pricingAr } from './copy/pricing.ar';
import { pricingEn } from './copy/pricing.en';
import { formatUsd, PRICING_FACTS } from './copy/pricing-facts';
import { selfHostingAr } from './copy/self-hosting.ar';
import { selfHostingEn } from './copy/self-hosting.en';
import { MarketingDataContext } from './page-data';
import { PricingPage } from './pricing';
import { isolateLatin } from './site/isolate-latin';

vi.mock('@/functions/marketing', () => ({ getGithubStarsFn: vi.fn(async () => 7) }));

const ORIGIN = new URL('/', 'http://localhost').origin;
type Head = {
  meta: { title?: string; property?: string; content?: string }[];
  links: { rel: string; hrefLang?: string; href: string }[];
  scripts: { children: string }[];
};
const pathOf = (href: string) => new URL(href, ORIGIN).pathname;
const arabicLetters = /[؀-ۿ]/;

describe('/ar/pricing', () => {
  const html = renderToStaticMarkup(<ArabicPricingPage />);
  const english = renderToStaticMarkup(<PricingPage />);

  it('renders Arabic, right to left, with the language switch on /pricing', () => {
    expect(html).toMatch(/^<div lang="ar" dir="rtl"/);
    expect(html).toContain(
      `<h1 class="mt-4 text-balance font-semibold text-4xl tracking-tight sm:text-5xl rtl:leading-relaxed rtl:tracking-normal">${pricingAr.header.title}</h1>`,
    );
    expect(html).toContain('href="/pricing" hrefLang="en" lang="en"');
    expect(html).not.toContain('Same core product, different operations');
  });

  it('shows the same prices as the English page, from one source', () => {
    const prices = (page: string) => [...page.matchAll(/<bdi dir="ltr">([^<]*)<\/bdi>/g)].map((match) => match[1]);
    const expected = [formatUsd(PRICING_FACTS.priceUsd.cloud), formatUsd(PRICING_FACTS.priceUsd.selfHosted)];
    expect(prices(html)).toEqual(expected);
    expect(prices(english)).toEqual(expected);
  });

  it('has the English structure: plan points, table rows, fine print and FAQ', () => {
    const shape = (copy: typeof pricingEn) => ({
      cloud: copy.cloud.points.length,
      selfHosted: copy.selfHosted.points.length,
      notes: copy.included.notes.length,
      groups: copy.included.groups.map((group) => group.rows.map((row) => [row.cloud === true, row.self === true])),
      finePrint: copy.finePrint.items.length,
      faq: copy.faq.items.length,
    });
    expect(shape(pricingAr)).toEqual(shape(pricingEn));
    expect(pricingEn.faq.items).toBe(marketingFaqs);
    expect(html.match(/<details/g)).toHaveLength(marketingFaqs.length);
    expect(html.match(/aria-label="مضمّن"/g)?.length).toBe(english.match(/aria-label="Included"/g)?.length);
  });

  it('links to the Arabic self-hosting page and keeps Latin names and versions isolated', () => {
    expect(html).toContain('href="/ar/self-hosting"');
    expect(html).toContain('<bdi>Docker Compose</bdi>');
    expect(html).toContain(`<bdi>${PRICING_FACTS.selfHostedRelease}</bdi>`);
    expect(html).toContain(`<bdi>${PRICING_FACTS.supportEmail}</bdi>`);
  });

  it('writes Arabic copy throughout', () => {
    const strings = [
      pricingAr.header.title,
      pricingAr.included.title,
      ...pricingAr.included.groups.flatMap((group) => [group.title, ...group.rows.map((row) => row.label)]),
      ...pricingAr.faq.items.flatMap((item) => [item.q, item.a]),
    ];
    expect(strings.filter((text) => !arabicLetters.test(text))).toEqual([]);
  });

  it('states the interface locale count the catalog actually has', () => {
    const catalogs = readdirSync(new URL('../../../../../packages/i18n/messages', import.meta.url)).filter((file) => file.endsWith('.json'));
    expect(PRICING_FACTS.interfaceLocales).toBe(catalogs.length);
  });
});

describe('the plan comparison', () => {
  // A native table: screen readers can move by row and column and hear which
  // plan a cell belongs to, in both languages (the grid it replaced could not).
  it.each([
    ['en', () => renderToStaticMarkup(<PricingPage />), pricingEn],
    ['ar', () => renderToStaticMarkup(<ArabicPricingPage />), pricingAr],
  ] as const)('is a table with plan column headers and feature row headers (%s)', (lang, render, copy) => {
    const { document } = parseHTML(render());
    const tables = document.querySelectorAll('main table');
    expect(tables).toHaveLength(1);
    const table = tables[0] as Element;
    expect(table.closest('[dir]')?.getAttribute('dir')).toBe(lang === 'ar' ? 'rtl' : 'ltr');
    expect(table.querySelector('caption')?.textContent).toBe(copy.included.title);

    const columns = [...table.querySelectorAll('thead th[scope="col"]')].map((cell) => cell.textContent);
    expect(columns).toEqual([copy.cloud.name, copy.selfHosted.name]);

    const groups = [...table.querySelectorAll('tbody th[scope="rowgroup"]')];
    expect(groups.map((cell) => cell.textContent)).toEqual(copy.included.groups.map((group) => group.title));
    expect(groups.every((cell) => (cell.getAttribute('colspan') ?? cell.getAttribute('colSpan')) === '3')).toBe(true);

    const rows = [...table.querySelectorAll('tbody tr')].filter((row) => row.querySelector('th[scope="row"]'));
    const expected = copy.included.groups.flatMap((group) => group.rows);
    expect(rows.map((row) => row.querySelector('th[scope="row"]')?.textContent)).toEqual(expected.map((row) => row.label));
    rows.forEach((row, index) => {
      const cells = [...row.querySelectorAll('td')];
      expect(cells).toHaveLength(2);
      const values = [expected[index]?.cloud, expected[index]?.self];
      cells.forEach((cell, column) => {
        const value = values[column];
        if (value === true) expect(cell.querySelector('svg[role="img"]')?.getAttribute('aria-label')).toBe(copy.included.includedLabel);
        else expect(cell.textContent).toBe(value);
      });
    });
  });
});

describe('pricing and self-hosting heads', () => {
  const cases = [
    { page: () => import('./pages/pricing'), path: '/pricing', locale: 'en_US', title: pricingEn.meta.title, faq: pricingEn.faq.items },
    { page: () => import('./pages/ar-pricing'), path: '/ar/pricing', locale: 'ar_AR', title: pricingAr.meta.title, faq: pricingAr.faq.items },
    { page: () => import('./pages/self-hosting'), path: '/self-hosting', locale: 'en_US', title: selfHostingEn.meta.title, faq: null },
    { page: () => import('./pages/ar-self-hosting'), path: '/ar/self-hosting', locale: 'ar_AR', title: selfHostingAr.meta.title, faq: null },
  ];

  it.each(cases)('$path has its canonical, hreflang en/ar/x-default, title and structured data', async ({ page, path, locale, title, faq }) => {
    const { head } = (await (await page()).load()) as { head: Head };
    const english = path.replace(/^\/ar/, '');
    const links = Object.fromEntries(head.links.map((link) => [link.hrefLang ?? link.rel, pathOf(link.href)]));
    expect(links).toEqual({ canonical: path, en: english, ar: `/ar${english}`, 'x-default': english });
    expect(head.meta.find((entry) => entry.title)?.title).toBe(title);
    expect(head.meta.find((entry) => entry.property === 'og:locale')?.content).toBe(locale);

    const types = head.scripts.map((script) => JSON.parse(script.children)['@type']);
    expect(types).toEqual(faq ? ['FAQPage', 'BreadcrumbList'] : ['BreadcrumbList']);
    if (faq) {
      const questions = JSON.parse(head.scripts[0]?.children ?? '{}').mainEntity.map((entry: { name: string }) => entry.name);
      expect(questions).toEqual(faq.map((item) => item.q));
    }
    const crumbs = JSON.parse(head.scripts.at(-1)?.children ?? '{}').itemListElement.map((item: { item: string }) => pathOf(item.item));
    expect(crumbs).toEqual([path.startsWith('/ar') ? '/ar' : '/', path]);
  });
});

describe('isolateLatin', () => {
  it('wraps Latin runs in Arabic text and leaves the sentence punctuation outside', () => {
    expect(renderToStaticMarkup(<p>{isolateLatin('بترخيص AGPL-3.0، وCoolify.', 'ar')}</p>)).toBe(
      '<p>بترخيص <bdi class="whitespace-nowrap">AGPL-3.0</bdi>، و<bdi>Coolify</bdi>.</p>',
    );
    expect(isolateLatin('Docker Compose', 'en')).toBe('Docker Compose');
    expect(isolateLatin('بلا بطاقة دفع', 'ar')).toBe('بلا بطاقة دفع');
  });
});

describe('/ar/self-hosting', () => {
  it('renders Arabic, right to left, with the language switch on /self-hosting', async () => {
    const { Page } = await import('./pages/ar-self-hosting');
    const html = renderToStaticMarkup(
      <MarketingDataContext value={{ data: { stars: 0 }, params: {} }}>
        <Page />
      </MarketingDataContext>,
    );
    expect(html).toMatch(/^<div lang="ar" dir="rtl"/);
    expect(html).toContain(selfHostingAr.header.checksTitle);
    expect(html).toContain('href="/self-hosting" hrefLang="en" lang="en"');
    expect(html).toContain(`href="${selfHostingAr.header.guide.href}"`);
    expect(html).toContain('<bdi>PostgreSQL</bdi>');
  });

  it('mirrors the English sections, and its guide is the Arabic article', () => {
    expect(selfHostingAr.header.checks).toHaveLength(selfHostingEn.header.checks.length);
    expect(selfHostingAr.architecture.items).toHaveLength(selfHostingEn.architecture.items.length);
    expect(selfHostingAr.verify.paragraphs).toHaveLength(selfHostingEn.verify.paragraphs.length);
    expect(selfHostingAr.header.guide.href).toBe(`${selfHostingEn.header.guide.href}-ar`);
  });
});
