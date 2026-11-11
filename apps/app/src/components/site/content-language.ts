import { isRtlLanguage, type TextDirection } from '@nibleaf/shared/script-direction';
import type { SiteReaderContextValue } from '@/components/site/site-reader-context';

export interface ContentLanguageAttributes {
  lang?: string;
  dir?: TextDirection;
}

type ReaderShell = Pick<SiteReaderContextValue, 'lang' | 'languages'> | null | undefined;

/** A language's direction: the site's configured one, else a known-RTL guess. */
const languageDirection = (code: string, languages: SiteReaderContextValue['languages']): TextDirection => {
  const configured = languages?.find((language) => language.code === code)?.direction;
  return (configured ? configured === 'RTL' : isRtlLanguage(code)) ? 'rtl' : 'ltr';
};

const isFallback = (contentLanguage: string | undefined, shell: ReaderShell): shell is { lang: string } & NonNullable<ReaderShell> =>
  Boolean(contentLanguage && shell?.lang && contentLanguage !== shell.lang);

/**
 * `lang`/`dir` for content shown in a language other than the reader chrome's,
 * such as an English page shown as the fallback for a missing Arabic
 * translation: the article reads left to right inside the right-to-left shell.
 * Nothing is returned when the content is in the shell's language, so it keeps
 * inheriting from the document.
 */
export function contentLanguageAttributes(contentLanguage: string | undefined, shell: ReaderShell): ContentLanguageAttributes {
  if (!isFallback(contentLanguage, shell) || !contentLanguage) return {};
  return { lang: contentLanguage, dir: languageDirection(contentLanguage, shell.languages) };
}

/**
 * The reader chrome's own `lang`/`dir`, for chrome placed inside fallback
 * content (the fallback notice, the article's meta line): it reads in the
 * reader's language and direction while the article around it keeps its own.
 * Nothing is returned when the content is in the shell's language.
 */
export function chromeLanguageAttributes(contentLanguage: string | undefined, shell: ReaderShell): ContentLanguageAttributes {
  if (!isFallback(contentLanguage, shell)) return {};
  return { lang: shell.lang, dir: languageDirection(shell.lang, shell.languages) };
}

/** A language's name in that language ("العربية", "English"), as a reader
 *  looking for their own language recognizes it; the site's label, then the
 *  code, where the runtime has no name for it. */
export function languageEndonym(code: string, label?: string): string {
  try {
    const name = new Intl.DisplayNames([code], { type: 'language' }).of(code);
    if (name && name !== code) return name;
  } catch {
    // An invalid or unknown tag: fall through to the configured label.
  }
  return label || code;
}
