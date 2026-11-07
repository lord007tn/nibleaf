import type { MessageKey, MessageVariables } from '@nibleaf/i18n';
import { ApiResponseError } from './client-helpers';

type Translate = (key: MessageKey, variables?: MessageVariables) => string;

/** Server cases whose meaning no HTTP status conveys, keyed by error code or
 *  by `details.reason`. Checked before the status wording: refreshing never
 *  helps a promote blocked by changes on main. */
const ERROR_KEYS: Record<string, MessageKey> = {
  'branch:main_changed': 'error.branchMainChanged',
};
const keyFor = (value: string | undefined) => (value && Object.hasOwn(ERROR_KEYS, value) ? ERROR_KEYS[value] : undefined);

/**
 * Turn a failed request into a short, localized message a writer can act on.
 *
 * Server and network errors are English and technical ("fetch failed", Zod
 * paths, Prisma wording), so they are never shown as-is: the original error
 * goes to the console for debugging, and the toast says what happened in plain
 * words. Unknown failures fall back to the caller's action-specific message
 * (e.g. "Couldn't delete the page. Try again.").
 */
export function friendlyErrorMessage(
  t: Translate,
  error: unknown,
  fallbackKey: MessageKey,
  /** What a status means for this action, when the general wording would mislead
   *  (an invite's 409 is "already a member", not a concurrent edit). */
  statusKeys?: Partial<Record<number, MessageKey>>,
): string {
  console.error(error);
  if (error instanceof ApiResponseError) {
    const known = keyFor(error.code) ?? keyFor(error.reason);
    if (known) return t(known);
    const specific = statusKeys?.[error.status];
    if (specific) return t(specific);
    if (error.status === 401) return t('error.signedOut');
    if (error.status === 403) return t('error.noPermission');
    if (error.status === 404) return t('error.notFound');
    if (error.status === 409) return t('error.conflict');
    if (error.status === 413) return t('error.tooLarge');
    if (error.status === 429) return t('error.rateLimited');
    return t(fallbackKey);
  }
  // fetch() rejects with a TypeError when the request never reached the server.
  if (error instanceof TypeError) return t('error.network');
  return t(fallbackKey);
}
