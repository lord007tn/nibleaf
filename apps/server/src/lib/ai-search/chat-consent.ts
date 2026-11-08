import { analyticsConsentPolicy } from '@nibleaf/shared/analytics-consent';
import type { AiChatConsent } from '@nibleaf/validators';

/** Server and reader use the same owner policy, including native analytics. */
export const aiChatConsentRequired = (config: unknown): boolean => analyticsConsentPolicy(config) !== 'not_required';

/** A client cannot bypass required consent or a disabled legacy banner. */
export const trustedChatConsent = (config: unknown, consent: AiChatConsent): AiChatConsent => {
  const policy = analyticsConsentPolicy(config);
  if (policy === 'blocked') return 'denied';
  return consent === 'not_required' && policy === 'required' ? 'unknown' : consent;
};
