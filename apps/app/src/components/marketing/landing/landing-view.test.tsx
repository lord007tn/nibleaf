// @vitest-environment jsdom
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { landingAr } from '../copy/landing.ar';
import { landingEn } from '../copy/landing.en';
import { getUseCaseCards } from '../use-cases/use-case-cards';
import { ArabicLandingPage } from './arabic-landing-page';
import { LandingPage } from './landing-page';
import { LANDING_STORY_IDS } from './landing-view';

function render(Page: typeof LandingPage) {
  const root = document.createElement('div');
  root.innerHTML = renderToStaticMarkup(<Page stars={42} />);
  return root;
}

const pages = [
  ['en', LandingPage, landingEn],
  ['ar', ArabicLandingPage, landingAr],
] as const;

describe('marketing landing page', () => {
  it.each(pages)('keeps the compact nine-section page in %s', (_lang, Page) => {
    const sections = [...render(Page).querySelectorAll('main section')];
    expect(sections).toHaveLength(9);
    expect(sections.slice(2, 6).map((section) => section.id)).toEqual([...LANDING_STORY_IDS]);
  });

  it.each(pages)('keeps a three-question FAQ teaser and links to the rest (%s)', (_lang, Page, copy) => {
    const root = render(Page);
    const featured = copy.faq.items.filter((item) => item.featured);
    expect(featured).toHaveLength(3);
    expect([...root.querySelectorAll('#faq details summary')].map((summary) => summary.textContent)).toEqual(featured.map((item) => item.q));
    for (const link of copy.faq.moreLinks) expect(root.querySelector(`#faq a[href="${link.href}"]`)?.textContent).toBe(link.label);
    expect(copy.faq.moreLinks.map((link) => link.href)).toEqual(['/pricing#faq', '/blog']);
  });

  it.each(pages)('links out to pricing, comparisons, use cases and the blog (%s)', (lang, Page, copy) => {
    const root = render(Page);
    expect(root.querySelector(`#pricing a[href="${copy.paths.detailsLink.href}"]`)).not.toBeNull();
    for (const link of copy.compare.links) expect(root.querySelector(`#pricing a[href="${link.href}"]`)?.textContent).toBe(link.label);
    // The header's "Use cases" link targets `#use-cases`; every use-case page is listed there.
    for (const card of getUseCaseCards(lang)) expect(root.querySelector(`#use-cases a[href="${card.href}"]`)?.textContent).toBe(card.label);
    const prefix = lang === 'ar' ? '/ar' : '';
    expect(root.querySelector(`#ask-ai a[href="${prefix}/use-cases/support-teams"]`)).not.toBeNull();
    expect(root.querySelector(`#editor a[href="${prefix}/use-cases/product-docs"]`)).not.toBeNull();
  });

  it.each(pages)('keeps one h1 and never skips a heading level (%s)', (_lang, Page) => {
    const root = render(Page);
    const levels = [...root.querySelectorAll('main h1, main h2, main h3, main h4')].map((heading) => Number(heading.tagName[1]));
    expect(levels.filter((level) => level === 1)).toHaveLength(1);
    expect(levels[0]).toBe(1);
    for (const [index, level] of levels.entries()) if (index > 0) expect(level - (levels[index - 1] ?? 0)).toBeLessThanOrEqual(1);
  });
});
