import { isRtl, type Locale } from './locales';

export type { MessageFn, MessageVariables } from './message-types';

// biome-ignore lint/suspicious/noTsIgnore: Paraglide generates runtime JavaScript without declaration files.
// @ts-ignore -- Paraglide generates runtime JavaScript without declaration files.
import { baseLocale, getLocale, setLocale, toLocale } from './paraglide/runtime.js';

const languageListeners = new Set<() => void>();

export function subscribeLanguage(listener: () => void): () => void {
  languageListeners.add(listener);
  return () => languageListeners.delete(listener);
}

export async function setLanguage(locale: Locale): Promise<void> {
  await setLocale(locale, { reload: false });
  synchronizeDocumentLanguageFn(locale);
  for (const listener of languageListeners) listener();
}

export function synchronizeDocumentLanguageFn(requestedLocale?: Locale): void {
  if (typeof document === 'undefined') return;
  const locale = requestedLocale ?? (getLocale() as Locale);
  document.documentElement.lang = locale;
  document.documentElement.dir = isRtl(locale) ? 'rtl' : 'ltr';
}

/** The `<html>` attribute that names the interface locale of a server render
 *  (apps/app/src/routes/__root.tsx). The root omits it for the base locale. */
const RENDERED_LOCALE_ATTRIBUTE = 'data-locale';

/**
 * The interface locale the document was server-rendered in. On the server it is
 * the request's locale (see `./request-locale`). In the browser it is read from
 * `<html data-locale>`, so hydration compares against the server's choice even
 * when the browser alone would resolve another locale. Use it as the server
 * snapshot of every `useSyncExternalStore` that reads the locale.
 */
export function renderedLocale(): Locale {
  if (typeof document === 'undefined') return getLocale() as Locale;
  return (toLocale(document.documentElement.getAttribute(RENDERED_LOCALE_ATTRIBUTE)) ?? baseLocale) as Locale;
}

export { getLocale };
