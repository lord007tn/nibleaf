// @vitest-environment jsdom
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { GitHubStarLink } from './cloud-marketing';
import { CloudPage } from './marketing/cloud-page';
import { availabilityNote, heroAvailabilityNote, isRollingOut, ROLLOUT_WORDING } from './marketing/copy/availability';
import { landingAr } from './marketing/copy/landing.ar';
import { landingEn } from './marketing/copy/landing.en';
import { LANDING_META } from './marketing/copy/landing-meta';
import { ArabicLandingPage } from './marketing/landing/arabic-landing-page';
import { LandingPage } from './marketing/landing/landing-page';
import { LANDING_STORY_IDS } from './marketing/landing/landing-view';

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
    for (const feature of copy.features.filter((candidate) => (LANDING_STORY_IDS as readonly string[]).includes(candidate.id))) {
      expect(root.querySelector(`#${feature.id} h2`)?.textContent).toBe(feature.title);
      if (feature.note) expect(root.querySelector(`#${feature.id}`)?.textContent).toContain(feature.note);
    }
    expect(root.querySelectorAll('details')).toHaveLength(copy.faq.items.filter((item) => item.featured).length);
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
    expect(root.textContent).not.toMatch(/v0\.2\.0|next self-hosted release|Other SaaS|trusted by thousands|10,000 teams/i);
    expect(root.innerHTML).not.toMatch(/nibleaf-install\.sh|View Markdown|Copy Markdown/);
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
  ] as const)('words every new capability from its availability (%s)', (lang, copy, Page) => {
    for (const [id, capability] of Object.entries(rollingOut)) {
      const feature = copy.features.find((candidate) => candidate.id === id);
      expect(feature?.note, id).toContain(availabilityNote(capability, lang));
    }
    expect(copy.more.items.find((item) => item.icon === 'key')?.availability).toBe('bringYourOwnKey');
    const root = markup(renderToStaticMarkup(<Page />));
    const caption = heroAvailabilityNote(lang);
    if (caption) expect(root.textContent).toContain(caption);
    else expect(root.textContent).not.toMatch(ROLLOUT_WORDING);
  });

  it.each([
    ['en', landingEn, LandingPage],
    ['ar', landingAr, ArabicLandingPage],
  ] as const)('words reader themes, GitBook import and reader analytics from their availability (%s)', (lang, copy, Page) => {
    expect(copy.more.items.find((item) => item.icon === 'themes')?.availability).toBe('readerThemes');
    const arabicNote = copy.features.find((candidate) => candidate.id === 'arabic')?.note;
    if (isRollingOut('readerThemes') || isRollingOut('askAi')) expect(arabicNote).toContain(availabilityNote('readerThemes', lang));
    else expect(arabicNote).toBeUndefined();
    const expectCaption = (text: string | undefined, capability: 'gitbookImport' | 'readerAnalytics') => {
      if (isRollingOut(capability)) expect(text).toContain(availabilityNote(capability, lang));
      else expect(text).not.toMatch(ROLLOUT_WORDING);
    };
    expectCaption(copy.faq.items.find((item) => item.q.includes('GitBook'))?.a, 'gitbookImport');
    expectCaption(copy.faq.items.find((item) => /\bIP\b/.test(item.a))?.a, 'readerAnalytics');
    expect(copy.howItWorks.steps[0]?.body).not.toContain('GitBook');
    const text = markup(renderToStaticMarkup(<Page />)).textContent ?? '';
    expect(text).toContain(availabilityNote('readerThemes', lang));
    expect(text).not.toContain('undefined');
  });

  it('keeps capabilities that are still rolling out off the Cloud page', () => {
    const root = markup(renderToStaticMarkup(<CloudPage />));
    for (const item of landingEn.more.items.filter((candidate) => candidate.availability && isRollingOut(candidate.availability))) {
      expect(root.textContent).not.toContain(item.title);
    }
  });
});

describe('previews and secondary copy stay qualified', () => {
  it('describes AI answers in the search and social preview text without rollout wording', () => {
    expect(LANDING_META.en.title).not.toMatch(/AI answers/);
    expect(LANDING_META.en.description).toContain('with AI answers that cite your docs');
    for (const meta of Object.values(LANDING_META)) expect(meta.description).not.toMatch(ROLLOUT_WORDING);
  });

  it.each([
    ['en', landingEn, LandingPage],
    ['ar', landingAr, ArabicLandingPage],
  ] as const)('captions the AI steps only while Ask AI is rolling out (%s)', (lang, copy, Page) => {
    if (isRollingOut('askAi')) expect(copy.howItWorks.note).toContain(availabilityNote('askAi', lang));
    else expect(copy.howItWorks.note).toBeUndefined();
    const arabicAnswer = copy.faq.items.find((item) => item.q.includes(lang === 'ar' ? 'العربية' : 'Arabic'));
    if (isRollingOut('askAi')) expect(arabicAnswer?.a).toContain(availabilityNote('askAi', lang));
    else expect(arabicAnswer?.a).not.toMatch(ROLLOUT_WORDING);
    expect(copy.more.items.find((item) => item.icon === 'llms')?.body).toContain('llms-full.txt');
    // How it works no longer renders on the landing page (P2-MKT-005); the AI stories keep their own notes.
    const text = markup(renderToStaticMarkup(<Page />)).textContent ?? '';
    if (!isRollingOut('askAi')) expect(text).not.toMatch(ROLLOUT_WORDING);
  });

  it('keeps unverified Cloud claims off the Cloud page', () => {
    const text = markup(renderToStaticMarkup(<CloudPage />)).textContent ?? '';
    expect(text).not.toMatch(/automatic upgrades|custom domain|GitHub two-way sync/i);
    expect(text).not.toContain(landingEn.paths.body);
  });
});
