import { DEFAULT_LOCALE, resolveLocale } from '@nibleaf/i18n/locales';
import { editor_untitled } from '@nibleaf/i18n/messages/editor_untitled';

/**
 * The title readers see for a page. A page may be saved untitled (an empty
 * title, shown as a placeholder in the editor); everywhere a published title is
 * presented (navigation, headings, breadcrumbs, search, SEO, llms.txt, exports)
 * it reads "Untitled" in the page's own language instead of nothing. The stored
 * title stays empty, so the editor and the untitled-page check still see it.
 */
export const displayTitle = (page: { title: string; languageCode?: string | null }): string =>
  page.title.trim() ? page.title : editor_untitled(undefined, { locale: resolveLocale(page.languageCode) ?? DEFAULT_LOCALE });
