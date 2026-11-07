import type { MessageKey, MessageVariables } from '@nibleaf/i18n';
import { pickLiveDomain } from '@nibleaf/shared/domains';
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
  'domain:taken': 'settings.domain.error.taken',
  'domain:provider_failed': 'settings.domain.error.providerFailed',
  'domain:ownership_missing': 'settings.domain.error.ownershipMissing',
  'domain:not_pointed': 'settings.domain.error.notPointed',
  'domain:not_ready': 'settings.domain.error.notReady',
};

/** A domain request's failure in plain words: what went wrong and what to do next. */
export function domainErrorMessage(t: Translate, error: unknown, fallbackKey: MessageKey): string {
  const specific = error instanceof ApiResponseError && error.code ? DOMAIN_ERROR_KEYS[error.code] : undefined;
  if (specific) {
    console.error(error);
    return t(specific);
  }
  return friendlyErrorMessage(t, error, fallbackKey);
}
