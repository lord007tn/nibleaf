import type { MessageKey, MessageVariables } from '@nibleaf/i18n';
import { pickLiveDomain } from '@nibleaf/shared/domains';
import { isolate } from '@/lib/bidi';
import { ApiResponseError } from './client-helpers';
import { friendlyErrorMessage } from './errors';
import type { Domain } from './types';

type Translate = (key: MessageKey, variables?: MessageVariables) => string;

/** Where a custom domain is in its setup, in the order the owner meets the steps. */
export type DomainStage = 'waiting' | 'dnsProblem' | 'securing' | 'httpsProblem' | 'live';

export const domainStage = (domain: Pick<Domain, 'dnsStatus' | 'sslStatus'>): DomainStage => {
  if (domain.dnsStatus === 'ERROR') return 'dnsProblem';
  if (domain.dnsStatus !== 'VERIFIED') return 'waiting';
  if (domain.sslStatus === 'ACTIVE') return 'live';
  return domain.sslStatus === 'ERROR' ? 'httpsProblem' : 'securing';
};

// One rule for where readers go, shared with the API's links (see @nibleaf/shared/domains).
export { pickLiveDomain };

const DOMAIN_ERROR_KEYS: Partial<Record<string, MessageKey>> = {
  'validation:failed': 'settings.domain.error.invalid',
  'domain:already_added': 'settings.domain.error.alreadyAdded',
  'domain:provider_failed': 'settings.domain.error.providerFailed',
  'domain:ownership_missing': 'settings.domain.error.ownershipMissing',
  'domain:not_pointed': 'settings.domain.error.notPointed',
  'domain:not_ready': 'settings.domain.error.notReady',
  'domain:check_inconclusive': 'settings.domain.error.checkInconclusive',
};

/** A domain request's failure in plain words: what went wrong and what to do next. */
export function domainErrorMessage(t: Translate, error: unknown, fallbackKey: MessageKey): string {
  // Connected elsewhere: the server names the site only when it is one of the person's own.
  if (error instanceof ApiResponseError && error.code === 'domain:already_connected') {
    console.error(error);
    const siteName = error.details?.scope === 'same_workspace' ? error.details.siteName : undefined;
    return typeof siteName === 'string' && siteName.trim()
      ? t('settings.domain.error.connectedToSite', { site: isolate(siteName) })
      : t('settings.domain.error.connectedElsewhere');
  }
  const specific = error instanceof ApiResponseError && error.code ? DOMAIN_ERROR_KEYS[error.code] : undefined;
  if (specific) {
    console.error(error);
    return t(specific);
  }
  return friendlyErrorMessage(t, error, fallbackKey);
}

/** A failed check that also stopped the domain being the main address (readers now go to the default one). */
export const demotedByError = (error: unknown): boolean => error instanceof ApiResponseError && error.details?.demoted === true;
