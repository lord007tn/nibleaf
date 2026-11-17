import { rememberInterfaceLocale } from '@nibleaf/i18n/locale-state';
import { useEffect } from 'react';

/** Where an Arabic marketing visitor starts using the product. */
const PRODUCT_ENTRY = /^\/(?:sign-up|sign-in)(?:\/|$)/u;

/** Whether `pathname` is an Arabic marketing page (`/ar`, `/ar/...`). */
const isArabicMarketingPath = (pathname: string): boolean => pathname === '/ar' || pathname.startsWith('/ar/');

/**
 * A visitor reading the Arabic marketing site chose Arabic. When they follow a
 * link from it to sign-up or sign-in, that choice is saved as their interface
 * language, so sign-up and then the dashboard render in Arabic, right to left,
 * whatever the browser's own language. Only that click saves it: browsing `/ar`
 * alone doesn't override a language the visitor picked in the product.
 */
export function useRememberMarketingLanguage(pathname: string): void {
  const arabic = isArabicMarketingPath(pathname);
  useEffect(() => {
    if (!arabic) return;
    const follow = (event: MouseEvent) => {
      const anchor = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>('a[href]') : null;
      if (!anchor) return;
      const url = new URL(anchor.href, window.location.href);
      if (url.origin === window.location.origin && PRODUCT_ENTRY.test(url.pathname)) rememberInterfaceLocale('ar');
    };
    document.addEventListener('click', follow, true);
    document.addEventListener('auxclick', follow, true);
    return () => {
      document.removeEventListener('click', follow, true);
      document.removeEventListener('auxclick', follow, true);
    };
  }, [arabic]);
}
