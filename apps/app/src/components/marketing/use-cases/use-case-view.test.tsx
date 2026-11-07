// @vitest-environment jsdom
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { BLOG_ENTRIES } from '@/lib/blog';
import { MARKETING_SITEMAP } from '@/lib/marketing-sitemap';
import { availabilityNote, heroAvailabilityNote } from '../copy/availability';
import { shellAr } from '../copy/shell.ar';
import type { UseCaseSlug } from '../copy/types';
import { USE_CASE_SLUGS } from '../copy/use-case-meta';
import { useCasesAr, useCasesTeaserAr } from '../copy/use-cases.ar';
import { useCasesEn, useCasesTeaserEn } from '../copy/use-cases.en';
import { ArabicUseCasePage } from './arabic-use-case-page';
import { getUseCaseCards } from './use-case-cards';
import { UseCasePage } from './use-case-page';
import { UseCasesTeaser } from './use-cases-teaser';

function markup(html: string) {
  const root = document.createElement('div');
  root.innerHTML = html;
  return root;
}

const pages = [
  ['en', UseCasePage, useCasesEn, (slug: UseCaseSlug) => `/ar/use-cases/${slug}`, 'ar', 'Requirements:'],
  ['ar', ArabicUseCasePage, useCasesAr, (slug: UseCaseSlug) => `/use-cases/${slug}`, 'en', 'المتطلبات:'],
] as const;

const knownPaths = new Set([...MARKETING_SITEMAP.map((entry) => entry.path), '/blog', '/sign-up']);

describe.each(pages)('%s use-case pages', (lang, Page, copies, alternate, alternateLang, requirements) => {
  it.each(USE_CASE_SLUGS)('renders the complete %s page on the server', (slug) => {
    const copy = copies[slug];
    const root = markup(renderToStaticMarkup(<Page slug={slug} stars={42} />));
    const shell = root.firstElementChild;
    expect(shell?.getAttribute('lang')).toBe(lang);
    expect(shell?.getAttribute('dir')).toBe(lang === 'ar' ? 'rtl' : 'ltr');
    expect(root.querySelector('main#main')).not.toBeNull();
    expect(root.querySelector('header nav')).not.toBeNull();
    expect(root.querySelector('footer')).not.toBeNull();

    expect(root.querySelectorAll('h1')).toHaveLength(1);
    expect(root.querySelector('h1')?.textContent).toBe(copy.hero.title);
    // Headings never skip a level inside <main>.
    let previous = 1;
    for (const heading of root.querySelectorAll('main h1, main h2, main h3, main h4')) {
      const level = Number(heading.tagName[1]);
      expect(level - previous).toBeLessThanOrEqual(1);
      previous = level;
    }

    // The language switch points at the same page in the other language.
    expect(root.querySelector(`a[href="${alternate(slug)}"][hreflang="${alternateLang}"]`)).not.toBeNull();

    const main = root.querySelector('main') as HTMLElement;
    expect(main.querySelectorAll('a[href="/sign-up"]').length).toBeGreaterThanOrEqual(2);
    expect(main.querySelectorAll('a[href="/self-hosting"]').length).toBeGreaterThanOrEqual(2);
    expect(main.querySelector('a[href="/sign-up"]')?.textContent).toBe(copy.hero.primaryCta.label);

    for (const problem of copy.problems.items) expect(main.textContent).toContain(problem.body);
    for (const feature of copy.solutions) {
      const row = root.querySelector(`section#${feature.id}`);
      expect(row?.getAttribute('aria-labelledby')).toBe(`${feature.id}-title`);
      expect(row?.querySelector('h2')?.textContent).toBe(feature.title);
      const label = feature.noteLabel ? `${feature.noteLabel}:` : requirements;
      if (feature.note) expect(row?.textContent).toContain(`${label} ${feature.note}`);
      else expect(row?.textContent).not.toContain(requirements);
    }
    expect(root.querySelectorAll('#workflow ol > li')).toHaveLength(copy.workflow.steps.length);
    expect(root.querySelectorAll('#faq details')).toHaveLength(copy.faq.items.length);

    const related = [...root.querySelectorAll('#related h3 a')];
    expect(related.map((link) => link.getAttribute('href'))).toEqual(copy.related.links.map((link) => link.href));
    for (const link of copy.related.links) {
      const blog = /^\/blog\/(.+)$/.exec(link.href);
      if (blog)
        expect(
          BLOG_ENTRIES.some((entry) => entry.slug === blog[1]),
          link.href,
        ).toBe(true);
      else expect(knownPaths.has(link.href), link.href).toBe(true);
    }

    for (const image of root.querySelectorAll('img')) {
      if (image.closest('[aria-hidden="true"]')) {
        expect(image.getAttribute('alt')).toBe('');
        continue;
      }
      expect(Number(image.getAttribute('width'))).toBeGreaterThan(0);
      expect(image.getAttribute('alt')?.length).toBeGreaterThan(0);
    }

    expect(root.textContent).not.toMatch(/v0\.2|trusted by thousands|10,000 teams/i);
  });
});

describe('use-cases teaser', () => {
  it.each([
    ['en', useCasesEn, useCasesTeaserEn, '/use-cases/'],
    ['ar', useCasesAr, useCasesTeaserAr, '/ar/use-cases/'],
  ] as const)('links all three %s pages with their card copy', (lang, copies, teaser, prefix) => {
    const cards = getUseCaseCards(lang);
    expect(cards.map((card) => card.href)).toEqual(USE_CASE_SLUGS.map((slug) => `${prefix}${slug}`));
    for (const card of cards) {
      expect(card.label).toBe(copies[card.slug].navLabel);
      expect(card.summary).toBe(copies[card.slug].cardSummary);
    }

    const root = markup(renderToStaticMarkup(<UseCasesTeaser lang={lang} />));
    const section = root.querySelector('section#use-cases');
    expect(section?.getAttribute('aria-labelledby')).toBe('use-cases-title');
    expect(section?.querySelector('h2#use-cases-title')?.textContent).toBe(teaser.title);
    expect(section?.textContent).toContain(teaser.eyebrow);
    expect(section?.textContent).toContain(teaser.body);
    const links = [...root.querySelectorAll('h3 a')];
    expect(links.map((link) => link.getAttribute('href'))).toEqual(cards.map((card) => card.href));
    expect(links.map((link) => link.textContent)).toEqual(cards.map((card) => card.label));
    for (const card of cards) expect(section?.textContent).toContain(card.summary);
  });

  it('accepts explicit teaser copy and cards', () => {
    const root = markup(
      renderToStaticMarkup(
        <UseCasesTeaser
          lang="en"
          teaser={{ eyebrow: 'E', title: 'T', body: 'B' }}
          cards={[{ slug: 'api-docs', label: 'Only one', summary: 'S', href: '/use-cases/api-docs' }]}
        />,
      ),
    );
    expect(root.querySelector('h2')?.textContent).toBe('T');
    expect(root.querySelectorAll('h3 a')).toHaveLength(1);
  });
});

describe('use-case availability honesty', () => {
  it.each(pages)('captions the %s support hero and AI answers while those capabilities roll out', (lang, Page, copies) => {
    const copy = copies['support-teams'];
    expect(copy.hero.availabilityNote).toBe(heroAvailabilityNote(lang));
    const root = markup(renderToStaticMarkup(<Page slug="support-teams" stars={0} />));
    const hero = root.querySelector('h1')?.closest('div');
    expect(hero?.textContent).toContain(copy.hero.availabilityNote);
    const answers = copy.faq.items.map((item) => item.a).join('\n');
    expect(answers).toContain(availabilityNote('askAi', lang));
    expect(answers).toContain(availabilityNote('docsInsights', lang));
  });
});

describe('use-case media honesty', () => {
  it.each(pages)('shows no borrowed capture beside the %s OpenAPI reference section', (_lang, Page, copies) => {
    expect(copies['api-docs'].solutions.find((solution) => solution.id === 'openapi-reference')?.media).toBeUndefined();
    const root = markup(renderToStaticMarkup(<Page slug="api-docs" stars={0} />));
    const section = root.querySelector('section#openapi-reference');
    expect(section?.querySelector('h2')).not.toBeNull();
    expect(section?.querySelector('img, picture, video')).toBeNull();
  });
});

describe('use-case release honesty', () => {
  it.each(pages)('qualifies %s features newer than the latest self-hosted release', (lang, Page, copies) => {
    const themes = copies['product-docs'].solutions.find((solution) => solution.id === 'themes');
    expect(themes?.note).toBe(availabilityNote('readerThemes', lang));
    expect(copies['api-docs'].solutions.find((solution) => solution.id === 'openapi-reference')?.note).toContain(
      availabilityNote('readerThemes', lang),
    );
    for (const copy of Object.values(copies)) {
      for (const step of copy.workflow.steps) expect(step.body).not.toContain('GitBook');
    }
    const root = markup(renderToStaticMarkup(<Page slug="product-docs" stars={0} />));
    expect(root.querySelector('section#themes')?.textContent).toContain(`${themes?.noteLabel}: ${themes?.note}`);
  });
});

describe('use-case copy qualifies every feature newer than the latest self-hosted release', () => {
  const gated = {
    en: /Ask AI|MCP|AI assistant|Qdrant|ClickHouse|Signal|\btheme|insights|⌘K|start-here/i,
    ar: /اسأل المساعد|MCP|مساعد الذكاء|مساعدي الذكاء|مساعدك الذكي|Qdrant|ClickHouse|Signal|قالب|قوالب|التحليلات|⌘K|ابدأ من هنا/,
  } as const;

  it.each(pages)('%s sections, workflows and answers carry the availability note', (lang, _Page, copies) => {
    const note = availabilityNote('askAi', lang);
    for (const copy of Object.values(copies)) {
      for (const solution of copy.solutions) {
        const text = [solution.title, solution.body, ...solution.bullets].join(' ');
        if (gated[lang].test(text)) expect(solution.note, `${copy.slug}/${solution.id}`).toContain(note);
      }
      if (copy.workflow.steps.some((step) => gated[lang].test(`${step.title} ${step.body}`))) {
        expect(copy.workflow.note, `${copy.slug} workflow`).toContain(note);
      }
      for (const item of copy.faq.items) {
        if (gated[lang].test(item.a)) expect(`${item.a} ${copy.faq.note ?? ''}`, `${copy.slug}: ${item.q}`).toContain(note);
      }
    }
  });

  it.each(pages)('%s pages describe the MCP recording as the landing page does', (lang, _Page, copies) => {
    for (const copy of Object.values(copies)) {
      const mcp = copy.solutions.find((solution) => solution.media?.key === 'mcp');
      if (mcp?.media) expect(mcp.media.caption).toMatch(lang === 'ar' ? /مختلَقة/ : /made up/);
    }
  });
});

it('reads the GitHub star count in Arabic on Arabic pages', () => {
  const root = markup(renderToStaticMarkup(<ArabicUseCasePage slug="support-teams" stars={42} />));
  expect(root.textContent).toContain(shellAr.github.starsLabel(42));
});
