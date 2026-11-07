// @vitest-environment jsdom
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { BLOG_ENTRIES } from '@/lib/blog';
import { CloudPage, GitHubStarLink, LandingPage } from './cloud-marketing';
import { ArabicLandingPage } from './marketing/arabic-landing';
import { availabilityNote, heroAvailabilityNote, isRollingOut } from './marketing/copy/availability';
import { landingAr } from './marketing/copy/landing.ar';
import { landingEn } from './marketing/copy/landing.en';

function markup(html: string) {
  const root = document.createElement('div');
  root.innerHTML = html;
  return root;
}

describe('bilingual landing journey', () => {
  it.each([
    ['en', LandingPage, landingEn, '/ar', 'ar'],
    ['ar', ArabicLandingPage, landingAr, '/', 'en'],
  ] as const)('renders the complete %s journey on the server', (lang, Page, copy, alternate, alternateLang) => {
    const root = markup(renderToStaticMarkup(<Page stars={42} />));
    expect(root.firstElementChild?.getAttribute('lang')).toBe(lang);
    expect(root.firstElementChild?.getAttribute('dir')).toBe(lang === 'ar' ? 'rtl' : 'ltr');
    expect(root.querySelectorAll('h1')).toHaveLength(1);
    expect(root.querySelector('h1')?.textContent).toBe(copy.hero.title);
    expect(root.querySelector('main#main')).not.toBeNull();
    expect(root.querySelector('a[href="#main"]')).not.toBeNull();
    expect(root.querySelector(`a[href="${alternate}"][hreflang="${alternateLang}"]`)).not.toBeNull();
    expect(root.querySelector('main a[href="/sign-up"]')).not.toBeNull();
    expect(root.querySelector('main a[href="/self-hosting"]')).not.toBeNull();
    expect(root.querySelector('#features')).not.toBeNull();
    for (const feature of copy.features) {
      expect(root.querySelector(`#${feature.id} h2`)?.textContent).toBe(feature.title);
      if (feature.note) expect(root.querySelector(`#${feature.id}`)?.textContent).toContain(feature.note);
    }
    expect(root.querySelectorAll('details')).toHaveLength(copy.faq.items.length);
    for (const image of root.querySelectorAll('img')) {
      // The hero's desktop capture is decorative (aria-hidden); the phone capture beside it carries the description.
      if (image.closest('[aria-hidden="true"]')) {
        expect(image.getAttribute('alt')).toBe('');
        continue;
      }
      expect(Number(image.getAttribute('width'))).toBeGreaterThan(0);
      expect(Number(image.getAttribute('height'))).toBeGreaterThan(0);
      expect(image.getAttribute('alt')?.length).toBeGreaterThan(0);
    }
    expect(root.textContent).not.toMatch(/v0\.2|Other SaaS|trusted by thousands|10,000 teams/i);
    expect(root.innerHTML).not.toMatch(/nibleaf-install\.sh|View Markdown|Copy Markdown/);
  });

  it.each([
    ['en', LandingPage],
    ['ar', ArabicLandingPage],
  ] as const)('shows the newest same-language posts only (%s)', (lang, Page) => {
    const root = markup(renderToStaticMarkup(<Page />));
    const expected = BLOG_ENTRIES.filter((post) => (post.language ?? 'en') === lang).slice(0, 3);
    const links = [...root.querySelectorAll('#from-the-blog article h3 a')];
    expect(links.map((link) => link.getAttribute('href'))).toEqual(expected.map((post) => `/blog/${post.slug}`));
    for (const link of links) expect(link.getAttribute('lang')).toBe(lang);
    for (const post of BLOG_ENTRIES.filter((post) => (post.language ?? 'en') !== lang)) {
      expect(root.querySelector(`#from-the-blog a[href="/blog/${post.slug}"]`)).toBeNull();
    }
  });

  it('keeps CloudPage usable with the shared marketing shell', () => {
    const root = markup(renderToStaticMarkup(<CloudPage />));
    expect(root.querySelectorAll('h1')).toHaveLength(1);
    expect(root.querySelector('main a[href="/sign-up"]')).not.toBeNull();
    expect(root.querySelector('main a[href="/self-hosting"]')).not.toBeNull();
  });
});

describe('GitHubStarLink', () => {
  it.each([0, 0.5, Number.NaN, -1])('does not turn an unavailable count into proof (%s)', (stars) => {
    const link = markup(renderToStaticMarkup(<GitHubStarLink stars={stars} />)).querySelector('a');
    expect(link?.getAttribute('href')).toBe('https://github.com/lord007tn/nibleaf');
    expect(link?.hasAttribute('aria-label')).toBe(false);
    expect(link?.textContent).toBe('Star on GitHub');
    expect(link?.querySelector('[data-github-stars]')).toBeNull();
  });
  it('includes the visible label and the exact count in the accessible name', () => {
    const link = markup(renderToStaticMarkup(<GitHubStarLink stars={1234} compact label="GitHub" />)).querySelector('a');
    expect(link?.hasAttribute('aria-label')).toBe(false);
    // Visible text first, in order, then the exact count for screen readers.
    expect(link?.textContent).toBe('GitHub1.2k (1,234 stars)');
    expect(link?.querySelector('.sr-only')?.textContent).toBe(' (1,234 stars)');
    expect(link?.querySelector('[data-github-stars="1234"]')?.textContent).toBe('1.2k');
  });
});

describe('availability honesty', () => {
  const rollingOut = { 'ask-ai': 'askAi', search: 'readerSearch', insights: 'docsInsights', mcp: 'supportMcp' } as const;

  it.each([
    ['en', landingEn, LandingPage],
    ['ar', landingAr, ArabicLandingPage],
  ] as const)('qualifies every capability that is still rolling out (%s)', (lang, copy, Page) => {
    for (const [id, capability] of Object.entries(rollingOut)) {
      const feature = copy.features.find((candidate) => candidate.id === id);
      expect(feature?.note, id).toContain(availabilityNote(capability, lang));
    }
    expect(copy.more.items.find((item) => item.icon === 'key')?.availability).toBe('bringYourOwnKey');
    const root = markup(renderToStaticMarkup(<Page />));
    const caption = heroAvailabilityNote(lang);
    if (caption) expect(root.textContent).toContain(caption);
    expect(root.textContent).toContain(availabilityNote('bringYourOwnKey', lang));
  });

  it('keeps capabilities that are still rolling out off the Cloud page', () => {
    const root = markup(renderToStaticMarkup(<CloudPage />));
    for (const item of landingEn.more.items.filter((candidate) => candidate.availability && isRollingOut(candidate.availability))) {
      expect(root.textContent).not.toContain(item.title);
    }
  });
});
