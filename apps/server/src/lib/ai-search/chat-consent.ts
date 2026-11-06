import type { AiChatConsent } from '@nibleaf/validators';

/** Mirrors the reader's consent banner rule (apps/app site-analytics-consent):
 * consent is required only when the banner applies, i.e. consent delivery is on
 * and third-party analytics scripts are configured. */
export const aiChatConsentRequired = (config: unknown): boolean => {
  const value = (config ?? {}) as {
    addons?: { consentBanner?: { enabled?: boolean } };
    analytics?: { cookieConsent?: boolean; ga4?: string; plausible?: string };
  };
  const banner = value.addons?.consentBanner;
  const consentMode = banner ? banner.enabled === true : value.analytics?.cookieConsent === true;
  const ga4 = value.analytics?.ga4?.trim();
  const plausible = value.analytics?.plausible?.trim();
  return consentMode && Boolean((ga4 && /^[\w-]+$/.test(ga4)) || (plausible && /^[\w.-]+$/.test(plausible)));
};

/** The reader's consent as analytics may trust it: a client cannot claim consent
 * is not required on a site whose banner applies. */
export const trustedChatConsent = (config: unknown, consent: AiChatConsent): AiChatConsent =>
  consent === 'not_required' && aiChatConsentRequired(config) ? 'unknown' : consent;
