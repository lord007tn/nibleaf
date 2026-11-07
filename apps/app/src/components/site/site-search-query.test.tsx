import { siteSearchT } from '@nibleaf/i18n/site-search';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { withIsolatedQuery } from './site-search-dialog';

describe('search sentences around the reader’s query', () => {
  it('isolates an English query inside the Arabic sentence', () => {
    const t = siteSearchT('ar');
    const html = renderToStaticMarkup(<p>{withIsolatedQuery((query) => t('searchAskAiAbout', { query }), 'API keys?')}</p>);
    expect(html).toBe('<p>اسأل المساعد عن «<bdi>API keys?</bdi>»</p>');
  });

  it('isolates an Arabic query inside the English sentence', () => {
    const html = renderToStaticMarkup(<p>{withIsolatedQuery((query) => siteSearchT('en')('searchNoResultsFor', { query }), 'مفاتيح؟')}</p>);
    expect(html).toBe('<p>No results for “<bdi>مفاتيح؟</bdi>”</p>');
  });
});
