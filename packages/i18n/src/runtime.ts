import { isRtl, type Locale } from './locales';

export type { MessageFn, MessageVariables } from './message-types';

// biome-ignore lint/suspicious/noTsIgnore: Paraglide generates runtime JavaScript without declaration files.
// @ts-ignore -- Paraglide generates runtime JavaScript without declaration files.
import { baseLocale, getLocale, getServerAsyncLocalStorage, overwriteGetLocale, setLocale, toLocale } from './paraglide/runtime.js';

const languageListeners = new Set<() => void>();

export function subscribeLanguage(listener: () => void): () => void {
  languageListeners.add(listener);
  return () => languageListeners.delete(listener);
}

/** The `<html>` attribute that names the interface locale of a product server
 *  render (apps/app/src/routes/__root.tsx). Documents rendered outside a product
 *  request (marketing, the published reader) don't carry it. */
const RENDERED_LOCALE_ATTRIBUTE = 'data-locale';

/**
 * The interface locale a product document was server-rendered in, or undefined
 * for a document rendered outside a product request. On the server it is the
 * request's locale (see `./request-locale`); in the browser it is read from
 * `<html data-locale>`.
 */
export function documentInterfaceLocale(): Locale | undefined {
  if (typeof document === 'undefined') {
    const store = (getServerAsyncLocalStorage() as { getStore(): { locale?: string } | undefined } | undefined)?.getStore();
    return (toLocale(store?.locale) ?? undefined) as Locale | undefined;
  }
  return (toLocale(document.documentElement.getAttribute(RENDERED_LOCALE_ATTRIBUTE)) ?? undefined) as Locale | undefined;
}

/**
 * In the browser, a product document keeps the locale the server rendered for
 * its whole life, until the visitor explicitly picks another language
 * (`setLanguage`). Without this, `getLocale()` re-resolves from the cookie and
 * `navigator.languages` right after hydration, and an Arabic page the server
 * rendered for an Accept-Language visitor would flip to English. Paraglide's
 * own `getLocale` is overwritten, so message functions agree with the hooks.
 * Marketing and reader documents carry no `data-locale`, and keep resolving
 * the locale as before. The root never changes the attribute after the server
 * render, so reading it on each call is stable.
 */
let chosenLocale: Locale | undefined;
if (typeof document !== 'undefined') {
  const resolveLocale = getLocale;
  overwriteGetLocale(() => chosenLocale ?? documentInterfaceLocale() ?? resolveLocale());
}

/**
 * Saves `locale` as the visitor's interface language (the `NIBLEAF_LOCALE`
 * cookie) without switching this document's language: the next product page,
 * server-rendered or reached by client navigation, renders in it.
 */
export function rememberInterfaceLocale(locale: Locale): void {
  void setLocale(locale, { reload: false });
}

let prepareLanguage: ((locale: Locale) => Promise<boolean>) | undefined;
let languageChange = 0;
const languageFailureListeners = new Set<(locale: Locale) => void>();
const languageChoiceListeners = new Set<(locale: Locale) => void>();

/** Identifies the visitor's latest language choice, successful or not. */
export const languageChoice = (): number => languageChange;

/** Called as soon as the visitor chooses a language, before it is prepared. */
export function subscribeLanguageChoice(listener: (locale: Locale) => void): () => void {
  languageChoiceListeners.add(listener);
  return () => languageChoiceListeners.delete(listener);
}

/** Called when the visitor's latest language choice could not be prepared. The
 *  current language stays on screen; choosing again retries the download. */
export function subscribeLanguageFailure(listener: (locale: Locale) => void): () => void {
  languageFailureListeners.add(listener);
  return () => languageFailureListeners.delete(listener);
}

/** Installed only by the dashboard client catalog. Scoped auth and published
 * translators do not import or download dashboard messages. */
export function registerLanguagePreparation(prepare: (locale: Locale) => Promise<boolean>): void {
  if (typeof document !== 'undefined') prepareLanguage = prepare;
}

export async function setLanguage(locale: Locale): Promise<void> {
  // Request rendering uses withInterfaceLocale's async context. UI choices
  // must never change module-level locale state in a shared server process.
  if (typeof document === 'undefined') return;
  const change = ++languageChange;
  for (const listener of languageChoiceListeners) listener(locale);
  if (prepareLanguage && !(await prepareLanguage(locale))) {
    if (change === languageChange) for (const listener of languageFailureListeners) listener(locale);
    return;
  }
  if (change !== languageChange) return;
  await setLocale(locale, { reload: false });
  if (change !== languageChange) return;
  chosenLocale = locale;
  synchronizeDocumentLanguageFn(locale);
  for (const listener of languageListeners) listener();
}

export function synchronizeDocumentLanguageFn(requestedLocale?: Locale): void {
  if (typeof document === 'undefined') return;
  const locale = requestedLocale ?? (getLocale() as Locale);
  document.documentElement.lang = locale;
  document.documentElement.dir = isRtl(locale) ? 'rtl' : 'ltr';
}

/**
 * The interface locale the document was server-rendered in: the product
 * request's locale, else the base locale (marketing and reader documents render
 * the interface in it). Hydration compares against the server's choice even
 * when the browser alone would resolve another locale. Use it as the server
 * snapshot of every `useSyncExternalStore` that reads the locale.
 */
export function renderedLocale(): Locale {
  if (typeof document === 'undefined') return getLocale() as Locale;
  return documentInterfaceLocale() ?? (baseLocale as Locale);
}

export { getLocale };
