import { isRtl, type Locale } from './locales';

export type { MessageFn, MessageVariables } from './message-types';

// biome-ignore lint/suspicious/noTsIgnore: Paraglide generates runtime JavaScript without declaration files.
// @ts-ignore -- Paraglide generates runtime JavaScript without declaration files.
import { getLocale, setLocale } from './paraglide/runtime.js';

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

export { getLocale };
