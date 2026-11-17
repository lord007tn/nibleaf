import { AsyncLocalStorage } from 'node:async_hooks';
import type { Locale } from './locales';

// biome-ignore lint/suspicious/noTsIgnore: Paraglide generates runtime JavaScript without declaration files.
// @ts-ignore -- Paraglide generates runtime JavaScript without declaration files.
import { extractLocaleFromRequest, getServerAsyncLocalStorage, overwriteServerAsyncLocalStorage } from './paraglide/runtime.js';

/** What Paraglide's `getLocale()` reads on the server inside a request (its
 *  ParaglideAsyncLocalStorage store shape). */
interface RequestLocaleStore {
  locale?: Locale;
  origin?: string;
}

let storage: AsyncLocalStorage<RequestLocaleStore> | undefined;

/**
 * The interface locale a request asks for. Paraglide resolves it with the same
 * strategy the browser uses (apps/app/vite.config.ts): the `NIBLEAF_LOCALE`
 * cookie, then `Accept-Language`, then the base locale.
 */
export const requestInterfaceLocale = (request: Request): Locale => extractLocaleFromRequest(request) as Locale;

/**
 * Runs `render` with Paraglide's `getLocale()` answering `locale`: message
 * functions, `useLocale()` and the root document then render the request's
 * language on the server. The locale lives in an AsyncLocalStorage, so it is
 * scoped to this request's async context and never leaks into another request
 * rendering at the same time. Outside a scope, `getLocale()` keeps answering the
 * base locale.
 */
export function withInterfaceLocale<T>(locale: Locale, origin: string, render: () => T): T {
  if (!storage) {
    storage = (getServerAsyncLocalStorage() as AsyncLocalStorage<RequestLocaleStore> | undefined) ?? new AsyncLocalStorage<RequestLocaleStore>();
    overwriteServerAsyncLocalStorage(storage);
  }
  return storage.run({ locale, origin }, render);
}
