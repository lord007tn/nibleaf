import type { MessageKey, MessageVariables } from '@nibleaf/i18n';
import { ApiResponseError } from './client-helpers';

type Translate = (key: MessageKey, variables?: MessageVariables) => string;

// Stable server codes and detail reasons share this map. Keep each entry
// translated in EN/AR and covered through the existing action-specific caller.
// The promote refusals are keyed by code (`branch:*`). The `details.reason`
// lookup below is for errors that share a generic code and name their case in
// `details.reason` (e.g. a 409 `database:conflict` whose reason is a slug
// clash); a reason entry wins over its code.
const API_ERROR_MESSAGE_KEYS = new Map<string, MessageKey>([
  ['mcp:preview_stale', 'publish.reviewChanged'],
  ['slug_taken', 'editor.reorderSlugTaken'],
  ['branch:main_changed', 'error.branchMainChanged'],
  ['branch:baseline_missing', 'error.branchBaselineMissing'],
  ['promote_raced', 'error.promoteRaced'],
  ['branch:promote_blocked', 'error.promoteBlocked'],
]);

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
    // Shared code/reason messages take precedence over the caller's statusKeys.
    const messageKey = (error.reason ? API_ERROR_MESSAGE_KEYS.get(error.reason) : undefined) ?? API_ERROR_MESSAGE_KEYS.get(error.code ?? '');
    if (messageKey) return t(messageKey);
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
