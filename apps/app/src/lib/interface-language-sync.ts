import { getLocale, setLanguage, subscribeLanguage } from '@nibleaf/i18n/locale-state';
import { isSupportedLocale } from '@nibleaf/i18n/locales';

const LANGUAGE_CHANNEL = 'nibleaf-interface-language';

/**
 * Dashboard tabs share one interface language. A choice made in one tab reaches
 * the others through a BroadcastChannel, and each applies it through
 * `setLanguage`, so the catalog, `lang` and `dir` switch together. Before,
 * another tab's choice only reached a tab half-way (AUTH-20). Started by the
 * dashboard's locale module only, so published sites never carry it.
 * Returns a stop function (tests).
 */
export function startInterfaceLanguageSync(): () => void {
  if (typeof document === 'undefined' || typeof BroadcastChannel === 'undefined') return () => undefined;
  const otherTabs = new BroadcastChannel(LANGUAGE_CHANNEL);
  // The language another tab sent last: applying it here must not be sent back. A
  // locale (not a flag), so a choice made here while that one downloads still goes
  // out, and overlapping messages can't clear each other's guard.
  let fromOtherTab: string | undefined;
  otherTabs.onmessage = (event: MessageEvent) => {
    const locale = (event.data as { locale?: unknown } | null)?.locale;
    if (typeof locale !== 'string' || !isSupportedLocale(locale) || locale === getLocale()) return;
    fromOtherTab = locale;
    void setLanguage(locale);
  };
  const unsubscribe = subscribeLanguage(() => {
    const locale = getLocale();
    if (locale === fromOtherTab) {
      fromOtherTab = undefined;
      return;
    }
    otherTabs.postMessage({ locale });
  });
  return () => {
    unsubscribe();
    otherTabs.close();
  };
}
