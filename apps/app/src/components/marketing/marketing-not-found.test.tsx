/** @vitest-environment jsdom */
/** The marketing site's not-found page sits in its shell, in its language (MKT-003). */
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { isProductPath } from '@/components/not-found';
import MarketingNotFound from './marketing-not-found';

const render = (pathname: string) => {
  const host = document.createElement('div');
  host.innerHTML = renderToStaticMarkup(<MarketingNotFound pathname={pathname} />);
  return host;
};

describe('marketing not-found page', () => {
  it('keeps the marketing header, a main landmark and ways back', () => {
    const page = render('/no-such-page');
    expect(page.querySelector('header')).not.toBeNull();
    expect(page.querySelectorAll('main')).toHaveLength(1);
    expect(page.querySelector('main h1')?.textContent).toBe('Page not found');
    const links = Array.from(page.querySelectorAll('main ul a')).map((link) => link.getAttribute('href'));
    expect(links).toEqual(['/', '/pricing', 'https://docs.nibleaf.com']);
    expect(page.querySelector('a[href="#main"]')).not.toBeNull();
  });

  it('speaks Arabic, right to left, under /ar', () => {
    const page = render('/ar/pricing');
    const shell = page.firstElementChild;
    expect(shell?.getAttribute('lang')).toBe('ar');
    expect(shell?.getAttribute('dir')).toBe('rtl');
    expect(page.querySelector('main h1')?.textContent).toBe('الصفحة غير موجودة');
    expect(page.querySelector('main ul a')?.getAttribute('href')).toBe('/ar');
  });
});

describe('which not-found page an address gets', () => {
  it('keeps every dashboard address, in any case, on the product page', () => {
    for (const path of ['/app', '/app/missing', '/APP/missing', '/App']) expect(isProductPath(path), path).toBe(true);
    for (const path of ['/', '/pricing', '/application', '/ar/app']) expect(isProductPath(path), path).toBe(false);
  });
});
