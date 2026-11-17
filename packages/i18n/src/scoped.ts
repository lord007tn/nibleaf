import { useCallback, useSyncExternalStore } from 'react';
import type { Locale } from './locales';
import type { MessageFn, MessageVariables } from './message-types';
import { getLocale, renderedLocale, setLanguage, subscribeLanguage } from './runtime';

/*
 * Translators over a chosen set of messages. `translateFn` (./translate) reads
 * every message through Paraglide's namespace export, so any chunk that imports
 * it carries the whole catalog: every product message in every locale (about
 * 800 KB gzipped). A surface that needs a few dozen messages (sign-in, sign-up)
 * imports those message modules itself and translates through this module,
 * which never imports the catalog or the key map (MKT-001).
 */

/** Dotted product keys (as in ./message-ids) mapped to their Paraglide message
 *  modules. Typed by the caller's own literal keys: comparing against the full
 *  key union would cost the checker more than it catches. */
export type ScopedMessages = Readonly<Record<string, (inputs: never, options?: { locale?: Locale }) => string>>;

/** Translate `key` from `messages`; an unknown key reads as itself, as with translateFn. */
export const scopedTranslate = <Messages extends ScopedMessages>(
  messages: Messages,
  key: keyof Messages & string,
  variables?: MessageVariables,
  locale?: Locale,
): string => {
  // Variables are one loose shape here, as with translateFn.
  const message = messages[key] as unknown as MessageFn | undefined;
  return message?.(variables, locale ? { locale } : undefined) ?? key;
};

/** The interface locale, hydrating with the one the server rendered (as useLocale does). */
export function useInterfaceLocale() {
  const locale = useSyncExternalStore(subscribeLanguage, () => getLocale() as Locale, renderedLocale);
  const setLocale = useCallback((next: Locale) => {
    void setLanguage(next);
  }, []);
  return { locale, setLocale };
}

/** `useLocale()` over a chosen set of messages: `t` accepts only their keys. */
export function useScopedLocale<Messages extends ScopedMessages>(messages: Messages) {
  const { locale, setLocale } = useInterfaceLocale();
  const t = useCallback(
    (key: keyof Messages & string, variables?: MessageVariables) => scopedTranslate(messages, key, variables, locale),
    [messages, locale],
  );
  return { locale, setLocale, t };
}
