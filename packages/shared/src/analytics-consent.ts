/** Consent protects first-party identity as well as any optional third-party scripts. */
export const analyticsConsentPolicy = (config: unknown): 'required' | 'blocked' | 'not_required' => {
  const value = config as { analytics?: { cookieConsent?: boolean }; addons?: { consentBanner?: { enabled?: boolean } } } | null;
  const enabled = value?.addons?.consentBanner?.enabled;
  const required = value?.analytics?.cookieConsent === true;
  if (enabled === false) return required ? 'blocked' : 'not_required';
  return enabled === true || required ? 'required' : 'not_required';
};
