// @vitest-environment jsdom

import { setLanguage } from '@nibleaf/i18n/locale-state';
import { useMarketingT } from '@nibleaf/i18n/marketing';
import { cookieName } from '@nibleaf/i18n/runtime';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import arabicCatalog from '../../../../packages/i18n/messages/ar.json' with { type: 'json' };
import englishCatalog from '../../../../packages/i18n/messages/en.json' with { type: 'json' };
import { LandingPage } from './cloud-marketing';

const catalogs: Record<'en' | 'ar', Record<string, string>> = { en: englishCatalog, ar: arabicCatalog };

function MarketingLabels() {
  const t = useMarketingT();
  return (
    <div>
      <p>{t('marketing.release.searchPublishing')}</p>
      <p>{t('marketing.demo.arabic')}</p>
    </div>
  );
}

it('renders the publishing capability copy in the landing page SSR', () => {
  const html = renderToStaticMarkup(<LandingPage />);
  expect(html).toContain(catalogs.en['marketing.release.searchPublishing']);
  expect(html).not.toContain('marketing.release.searchPublishing');
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
