import { siteT } from '@nibleaf/i18n/site';
import { type ContentLanguageAttributes, languageEndonym } from '@/components/site/content-language';

// Marks where a language name goes in the translated sentence, so each name
// can be isolated in a <bdi>: "English" inside an Arabic sentence keeps its own
// direction and never reorders the punctuation around it.
const SLOT = '\u0000';

/** Splits a message formatted with slot markers back into text and <bdi> names. */
const withIsolatedNames = (message: string, names: string[]) =>
  message.split(SLOT).map((part, index) => (index % 2 === 1 ? <bdi key={`name-${part}`}>{names[Number(part)]}</bdi> : part));

/** A language's name in `locale` ("الإنجليزية" for `en` in Arabic), or null
 *  when the runtime can't name it there. */
const languageNameIn = (locale: string, code: string): string | null => {
  try {
    const name = new Intl.DisplayNames([locale], { type: 'language', fallback: 'none' }).of(code);
    return name && name !== code ? name : null;
  } catch {
    return null;
  }
};

/**
 * Tells a reader that the page they asked for in their language isn't
 * translated yet and that they are reading another language's version, in the
 * reader's own language and direction (the article below keeps the content's).
 * It offers the whole site in the page's language. Server-rendered with the
 * page, so it never shifts the layout when the page hydrates.
 */
export function LanguageFallbackNotice({
  requested,
  shown,
  href,
  attributes,
  languages,
}: {
  /** The reader's (shell) language. */
  requested: string;
  /** The language the page is shown in. */
  shown: string;
  /** This page with the site in the shown language. */
  href: string;
  /** The reader chrome's lang/dir. */
  attributes: ContentLanguageAttributes;
  languages?: ReadonlyArray<{ code: string; label?: string }>;
}) {
  const t = siteT(requested);
  const label = (code: string) => languages?.find((language) => language.code === code)?.label;
  // Inside the reader's sentence, a language is named in the reader's language
  // ("الإنجليزية" for an Arabic reader); its own name (the endonym) follows on
  // the link, which is where a reader of that language looks for it.
  const name = (code: string) => languageNameIn(requested, code) ?? languageEndonym(code, label(code));
  const shownName = name(shown);
  const shownEndonym = languageEndonym(shown, label(shown));
  return (
    <div
      role="note"
      className="mb-6 flex flex-wrap items-baseline gap-x-4 gap-y-1.5 rounded-lg border border-border bg-muted/40 px-4 py-3 text-sm"
      data-theme-region="language-fallback"
      {...attributes}
    >
      <p className="min-w-0">
        {withIsolatedNames(t('languageFallbackNotice', { requested: `${SLOT}0${SLOT}`, shown: `${SLOT}1${SLOT}` }), [name(requested), shownName])}
      </p>
      <a className="font-medium text-primary underline-offset-4 hover:underline" href={href} hrefLang={shown}>
        {withIsolatedNames(t('languageFallbackView', { language: `${SLOT}0${SLOT}` }), [shownName])}
        {shownEndonym !== shownName ? (
          <>
            {' ('}
            <bdi lang={shown}>{shownEndonym}</bdi>)
          </>
        ) : null}
      </a>
    </div>
  );
}
