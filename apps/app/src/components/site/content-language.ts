import { isRtlLanguage, type TextDirection } from '@nibleaf/shared/script-direction';
import { type SiteReaderContextValue, useSiteReader } from '@/components/site/site-reader-context';

export interface ContentLanguageAttributes {
  lang?: string;
  dir?: TextDirection;
}

/**
 * `lang`/`dir` for content shown in a language other than the reader chrome's,
 * such as an English page shown as the fallback for a missing Arabic
 * translation: the article reads left to right inside the right-to-left shell.
 * Nothing is returned when the content is in the shell's language, so it keeps
 * inheriting from the document.
 */
export function contentLanguageAttributes(
  contentLanguage: string | undefined,
  shell: Pick<SiteReaderContextValue, 'lang' | 'languages'> | null | undefined,
): ContentLanguageAttributes {
  if (!contentLanguage || !shell?.lang || contentLanguage === shell.lang) return {};
  const configured = shell.languages?.find((language) => language.code === contentLanguage)?.direction;
  const rtl = configured ? configured === 'RTL' : isRtlLanguage(contentLanguage);
  return { lang: contentLanguage, dir: rtl ? 'rtl' : 'ltr' };
}

/** contentLanguageAttributes against the surrounding reader chrome. */
export function useContentLanguageAttributes(contentLanguage: string | undefined): ContentLanguageAttributes {
  return contentLanguageAttributes(contentLanguage, useSiteReader());
}
