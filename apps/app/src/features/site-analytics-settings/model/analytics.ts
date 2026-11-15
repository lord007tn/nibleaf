/**
 * Site settings → Integrations → Analytics, as pure logic: what the form
 * edits, how it is validated, and what a save sends. Rendered by
 * `components/analytics-settings.tsx`; tested in `analytics.test.ts`.
 */

/** Everything the Analytics form edits, in one place, so "dirty" has one meaning. */
export type AnalyticsValues = {
  ga4: string;
  plausible: string;
  campaignDimensions: boolean;
  storePublicSearchTerms: boolean;
};

type AnalyticsConfigLike = {
  ga4?: string | null;
  plausible?: string | null;
  campaignDimensions?: boolean | null;
  storePublicSearchTerms?: boolean | null;
};

/**
 * The form's values for a site's config. Both privacy opt-ins are off unless
 * the site turned them on. `cookieConsent` is not edited here: the consent
 * add-on owns it.
 */
export function analyticsValues(config: { analytics?: AnalyticsConfigLike | null } | null | undefined): AnalyticsValues {
  const analytics = config?.analytics ?? {};
  return {
    ga4: analytics.ga4 ?? '',
    plausible: analytics.plausible ?? '',
    campaignDimensions: analytics.campaignDimensions === true,
    storePublicSearchTerms: analytics.storePublicSearchTerms === true,
  };
}

/** What a save stores: identifiers trimmed. */
export function normalizeAnalytics(values: AnalyticsValues): AnalyticsValues {
  return { ...values, ga4: values.ga4.trim(), plausible: values.plausible.trim() };
}

// The shapes the live-site injector accepts, so an invalid id is caught in the
// form instead of being silently dropped (and never emitting analytics).
const GA4_PATTERN = /^G-[A-Z0-9]+$/i;
const PLAUSIBLE_PATTERN = /^[a-z0-9.-]+\.[a-z]{2,}$/i;

/** A blank identifier is valid: it means "not connected". */
export const ga4Problem = (value: string): 'format' | undefined => {
  const id = value.trim();
  return id && !GA4_PATTERN.test(id) ? 'format' : undefined;
};

export const plausibleProblem = (value: string): 'format' | undefined => {
  const domain = value.trim();
  return domain && !PLAUSIBLE_PATTERN.test(domain) ? 'format' : undefined;
};

/** The `config.analytics` patch a save sends. Never `cookieConsent`: the API refuses it here. */
export type AnalyticsUpdate = {
  ga4?: string;
  plausible?: string;
  campaignDimensions: boolean;
  storePublicSearchTerms: boolean;
};

/**
 * The analytics patch for the change from `baseline` to `submitted`.
 *
 * The API merges `config.analytics` one level deep, so a key left out keeps its
 * stored value. Hence:
 * - a filled identifier is sent trimmed;
 * - a blank one is left out, as before, unless it was saved: then it is sent
 *   as `''`, which clears it (the reader and the integrations list treat an
 *   empty id as not connected). Leaving it out would keep the old id;
 * - both opt-ins are always sent, `false` included, so turning one off is
 *   stored and a save never leaves either undecided.
 */
export function analyticsUpdate(baseline: AnalyticsValues, submitted: AnalyticsValues): AnalyticsUpdate {
  const before = normalizeAnalytics(baseline);
  const after = normalizeAnalytics(submitted);
  const update: AnalyticsUpdate = {
    campaignDimensions: after.campaignDimensions,
    storePublicSearchTerms: after.storePublicSearchTerms,
  };
  if (after.ga4 || before.ga4) update.ga4 = after.ga4;
  if (after.plausible || before.plausible) update.plausible = after.plausible;
  return update;
}
