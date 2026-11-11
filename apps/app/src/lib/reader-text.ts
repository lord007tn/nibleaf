import { languageEndonym, languageNameIn } from '@nibleaf/shared/site';
import { localeTag } from '@/lib/format';

/**
 * Reader-facing strings that depend on the runtime's locale data (ICU): the
 * page's "Updated" date and language names. They are formatted once, by the
 * page's server function, and rendered verbatim on the server and on
 * hydration. A browser whose ICU words a date or a language differently then
 * can't produce a hydration mismatch.
 */
export interface ReaderText {
  /** The reader's (shell) language these strings are in. */
  language: string;
  /** The page's last update, a UTC calendar day in the reader's language. */
  updated: string;
  /** Each site language's name in the reader's language ("الإنجليزية"). */
  names: Record<string, string>;
  /** Each site language's own name ("English"). */
  endonyms: Record<string, string>;
}

/** A UTC calendar day, so a reader in any timezone sees the date the server shows. */
export const formatUpdated = (language: string | undefined, iso: string): string =>
  new Intl.DateTimeFormat(localeTag(language || 'en'), { dateStyle: 'medium', timeZone: 'UTC' }).format(new Date(iso));

export const readerTextFor = (language: string, updatedAt: string, codes: Iterable<string>): ReaderText => {
  const names: Record<string, string> = {};
  const endonyms: Record<string, string> = {};
  for (const code of new Set([language, ...codes])) {
    const name = languageNameIn(language, code);
    if (name) names[code] = name;
    const endonym = languageEndonym(code);
    if (endonym) endonyms[code] = endonym;
  }
  return { language, updated: formatUpdated(language, updatedAt), names, endonyms };
};
