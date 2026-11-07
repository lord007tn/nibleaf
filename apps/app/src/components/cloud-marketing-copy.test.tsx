// @vitest-environment jsdom
import { setLanguage } from '@nibleaf/i18n/locale-state';
import { useMarketingT } from '@nibleaf/i18n/marketing';
import { cookieName } from '@nibleaf/i18n/runtime';
import { act } from 'react';
import { createRoot, hydrateRoot } from 'react-dom/client';
import { renderToString } from 'react-dom/server';
import { expect, it } from 'vitest';
import arabicCatalog from '../../../../packages/i18n/messages/ar.json' with { type: 'json' };
import englishCatalog from '../../../../packages/i18n/messages/en.json' with { type: 'json' };
import { landingAr } from './marketing/copy/landing.ar';
import { landingEn } from './marketing/copy/landing.en';
import { ArabicLandingPage } from './marketing/landing/arabic-landing-page';
import { LandingPage } from './marketing/landing/landing-page';

// Plural (variant) messages are arrays; these tests read only plain marketing strings.
const catalogs = { en: englishCatalog, ar: arabicCatalog } as unknown as Record<'en' | 'ar', Record<string, string>>;

function MarketingLabels() {
  const t = useMarketingT();
  return (
    <div>
      <p>{t('marketing.release.searchPublishing')}</p>
      <p>{t('marketing.demo.arabic')}</p>
    </div>
  );
}

it.each([
  ['en', LandingPage, landingEn, 'ar'],
  ['ar', ArabicLandingPage, landingAr, 'en'],
] as const)('keeps %s copy stable through hydration with another document language', async (lang, Page, copy, preference) => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  document.documentElement.lang = preference;
  const container = document.createElement('div');
  container.innerHTML = renderToString(<Page />);
  document.body.append(container);
  const text = container.textContent;
  const errors: unknown[] = [];
  let root: ReturnType<typeof hydrateRoot> | undefined;
  try {
    await act(async () => {
      root = hydrateRoot(container, <Page />, { onRecoverableError: (error) => errors.push(error) });
    });
    expect(container.textContent).toBe(text);
    expect(container.querySelector('h1')?.textContent).toBe(copy.hero.title);
    expect(container.firstElementChild?.getAttribute('lang')).toBe(lang);
    expect(document.documentElement.lang).toBe(preference);
    expect(errors).toEqual([]);
  } finally {
    await act(async () => root?.unmount());
    container.remove();
    document.documentElement.lang = 'en';
  }
});

it('keeps both sparse marketing labels translated when the interface language changes', async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  try {
    await act(async () => {
      await setLanguage('en');
      root.render(<MarketingLabels />);
    });
    for (const language of ['en', 'ar', 'en'] as const) {
      await act(async () => setLanguage(language));
      for (const [messageKey, catalogKey] of [
        ['marketing.release.searchPublishing', 'marketing.release.searchPublishing'],
        ['marketing.demo.arabic', 'marketing_demo_arabic'],
      ] as const) {
        expect(container.textContent).toContain(catalogs[language][catalogKey]);
        expect(container.textContent).not.toContain(messageKey);
      }
    }
  } finally {
    await act(async () => root.unmount());
    container.remove();
    // biome-ignore lint/suspicious/noDocumentCookie: isolated jsdom preference cleanup.
    document.cookie = `${cookieName}=; Max-Age=0; path=/`;
  }
});
