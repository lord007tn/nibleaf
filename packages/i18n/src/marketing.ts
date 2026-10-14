import { useCallback, useSyncExternalStore } from 'react';
import type { Locale } from './locales';
import { marketing_demo_arabic } from './paraglide/messages/marketing_demo_arabic.js';
import { getLocale, subscribeLanguage } from './runtime';

/** Shared public marketing components need only these two translated labels. */
export function useMarketingT() {
  const locale = useSyncExternalStore(
    subscribeLanguage,
    () => getLocale() as Locale,
    () => 'en' as Locale,
  );
  // Preserve the existing untranslated-key fallback for the legacy label.
  return useCallback(
    (key: 'marketing.demo.arabic' | 'marketing.release.searchPublishing') =>
      key === 'marketing.demo.arabic' ? marketing_demo_arabic({}, { locale }) : key,
    [locale],
  );
}
