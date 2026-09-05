import { getDomain } from 'tldts';

export const MARKETING_ANALYTICS_CONSENT_KEY = 'nibleaf.marketing.analytics.consent.v1';
export const MARKETING_ANALYTICS_CONSENT_EVENT = 'nibleaf:marketing-analytics-consent';
export const FIRST_PUBLISH_CONTEXT_KEY = 'nibleaf.first-publish-attribution.v1';

export type MarketingAnalyticsConsent = 'accepted' | 'declined' | 'pending';
export type MarketingAnalyticsLanguage = 'ar' | 'en';
export type MarketingCtaDestination = 'comparison' | 'contact' | 'docs' | 'pricing' | 'rtl_guide' | 'rtl_tool' | 'self_hosting' | 'signup';
export type MarketingCtaPlacement = 'final' | 'header' | 'hero' | 'resource_bridge';

type Gtag = (...args: unknown[]) => void;

export type MarketingAnalyticsTarget = { id: string; provider: 'ga4' | 'gtm'; ga4MeasurementId?: string };

declare global {
  interface Window {
    dataLayer?: unknown[];
    gtag?: Gtag;
    [key: `ga-disable-${string}`]: boolean | undefined;
  }
}

const GA4_ID = /^G-[A-Z0-9]{6,}$/u;
const GTM_ID = /^GTM-[A-Z0-9]{6,}$/u;
export const GTM_MARKETING_EVENT = 'nibleaf_marketing_event';
let activeTarget: MarketingAnalyticsTarget | null = null;
// Only consented events may wait for the public metadata request to select a
// target. Keep this bounded and in memory; never replay pre-consent activity.
const pendingEvents: { event: string; properties: Record<string, boolean | number | string>; pathname: string }[] = [];
const CTA_DESTINATIONS = new Set<MarketingCtaDestination>([
  'comparison',
  'contact',
  'docs',
  'pricing',
  'rtl_guide',
  'rtl_tool',
  'self_hosting',
  'signup',
]);
const CTA_PLACEMENTS = new Set<MarketingCtaPlacement>(['final', 'header', 'hero', 'resource_bridge']);
const TOOL_RESULTS = new Set(['insufficient_evidence', 'material_gaps', 'strong_evidence', 'work_remaining']);

export function marketingAnalyticsEnabled(pathname: string, siteProjectId?: string): boolean {
  if (siteProjectId) return false;
  return !['/app', '/sites', '/sign-in', '/forgot-password', '/reset-password', '/verify-email', '/accept-invite', '/git-preview'].some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}
const GTM_MARKETING_EVENT_NAMES = new Set([
  'cta_clicked',
  'first_publish_cta_clicked',
  'first_publish_landing_viewed',
  'free_tool_completed',
  'free_tool_cta_clicked',
  'free_tool_started',
  'page_view',
]);
const GTM_OPTIONAL_EVENT_FIELDS = [
  'language',
  'page_title',
  'method',
  'destination',
  'placement',
  'entry_point',
  'intent',
  'source',
  'product',
  'tool_slug',
  'rubric_version',
  'input_mode',
  'category_count',
  'checks_run',
  'checks_unknown',
  'result_type',
];

const exactKeys = (value: Record<string, unknown>, keys: string[]): boolean => {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
};

const validVersion = (value: unknown): boolean => typeof value === 'string' && /^\d+\.\d+\.\d+$/u.test(value);

/** Final privacy boundary for every event delivered to the Nibleaf GA property. */
function isApprovedMarketingAnalyticsEvent(event: string, properties: Record<string, unknown>): boolean {
  if (event === 'first_publish_landing_viewed') {
    return (
      exactKeys(properties, ['entry_point', 'intent', 'source']) &&
      properties.entry_point === 'organic_content' &&
      properties.intent === 'first_publish' &&
      (properties.source === 'docker_compose_guide' || properties.source === 'mintlify_introduction')
    );
  }
  if (event === 'first_publish_cta_clicked') {
    return (
      exactKeys(properties, ['destination', 'entry_point', 'intent', 'placement', 'source']) &&
      properties.destination === 'signup' &&
      properties.entry_point === 'organic_content' &&
      properties.intent === 'first_publish' &&
      properties.placement === 'article_bridge' &&
      (properties.source === 'docker_compose_guide' || properties.source === 'mintlify_introduction')
    );
  }
  if (event === 'cta_clicked') {
    return (
      exactKeys(properties, ['destination', 'language', 'page_path', 'placement']) &&
      CTA_DESTINATIONS.has(properties.destination as MarketingCtaDestination) &&
      properties.language === 'ar' &&
      typeof properties.page_path === 'string' &&
      (properties.page_path === '/ar' || properties.page_path.startsWith('/ar/')) &&
      properties.page_path.length <= 256 &&
      CTA_PLACEMENTS.has(properties.placement as MarketingCtaPlacement)
    );
  }
  if (properties.product !== 'nibleaf' || properties.tool_slug !== 'rtl-documentation-readiness') return false;
  if (event === 'free_tool_started') {
    return (
      exactKeys(properties, ['input_mode', 'page_path', 'product', 'rubric_version', 'tool_slug']) &&
      properties.input_mode === 'html' &&
      properties.page_path === '/tools/rtl-documentation-readiness' &&
      validVersion(properties.rubric_version)
    );
  }
  if (event === 'free_tool_completed') {
    return (
      exactKeys(properties, ['category_count', 'checks_run', 'checks_unknown', 'product', 'result_type', 'rubric_version', 'tool_slug']) &&
      Number.isInteger(properties.category_count) &&
      (properties.category_count as number) >= 1 &&
      (properties.category_count as number) <= 20 &&
      Number.isInteger(properties.checks_run) &&
      (properties.checks_run as number) >= 0 &&
      (properties.checks_run as number) <= 100 &&
      Number.isInteger(properties.checks_unknown) &&
      (properties.checks_unknown as number) >= 0 &&
      (properties.checks_unknown as number) <= 100 &&
      TOOL_RESULTS.has(properties.result_type as string) &&
      validVersion(properties.rubric_version)
    );
  }
  return (
    event === 'free_tool_cta_clicked' &&
    exactKeys(properties, ['destination', 'placement', 'product', 'tool_slug']) &&
    (properties.destination === 'fixture_corpus' || properties.destination === 'sample_project_signup') &&
    properties.placement === 'result_bridge'
  );
}

export const isGa4MeasurementId = (value: unknown): value is string => typeof value === 'string' && GA4_ID.test(value) && !/^G-X+$/u.test(value);

export const isGtmContainerId = (value: unknown): value is string => typeof value === 'string' && GTM_ID.test(value) && !/^GTM-X+$/u.test(value);

export function selectMarketingAnalyticsTarget(input?: { ga4MeasurementId?: unknown; gtmContainerId?: unknown }): MarketingAnalyticsTarget | null {
  if (isGtmContainerId(input?.gtmContainerId))
    return {
      id: input.gtmContainerId,
      provider: 'gtm',
      ...(isGa4MeasurementId(input.ga4MeasurementId) ? { ga4MeasurementId: input.ga4MeasurementId } : {}),
    };
  if (isGa4MeasurementId(input?.ga4MeasurementId)) return { id: input.ga4MeasurementId, provider: 'ga4' };
  return null;
}

export const readMarketingAnalyticsConsent = (): MarketingAnalyticsConsent => {
  if (typeof window === 'undefined') return 'pending';
  try {
    const stored = window.localStorage.getItem(MARKETING_ANALYTICS_CONSENT_KEY);
    return stored === 'accepted' || stored === 'declined' ? stored : 'pending';
  } catch {
    return 'pending';
  }
};

export const persistMarketingAnalyticsConsent = (choice: Exclude<MarketingAnalyticsConsent, 'pending'>): void => {
  window.localStorage.setItem(MARKETING_ANALYTICS_CONSENT_KEY, choice);
  if (choice === 'declined') {
    pendingEvents.length = 0;
    window.localStorage.removeItem(FIRST_PUBLISH_CONTEXT_KEY);
    for (const key of Object.keys(window.sessionStorage)) {
      if (key.startsWith(`${FIRST_PUBLISH_CONTEXT_KEY}.`)) window.sessionStorage.removeItem(key);
    }
  }
  window.dispatchEvent(new CustomEvent(MARKETING_ANALYTICS_CONSENT_EVENT, { detail: choice }));
};

const responseNonce = (): string | undefined => document.querySelector<HTMLMetaElement>('meta[property="csp-nonce"]')?.content || undefined;

const getGtag = (): Gtag => {
  window.dataLayer ??= [];
  window.gtag ??= function gtag() {
    // biome-ignore lint/complexity/noArguments: Google tag commands require the canonical array-like Arguments shape, not a rest-parameter Array.
    window.dataLayer?.push(arguments);
  };
  return window.gtag;
};

/** GTM Custom Event channel for approved marketing events. Consent Mode and
 * the direct-GA fallback continue to use canonical gtag Arguments commands. */
const pushGtmMarketingEvent = (
  eventName: string,
  properties: Record<string, boolean | number | string>,
  pathname = window.location.pathname,
): void => {
  if (!GTM_MARKETING_EVENT_NAMES.has(eventName) || !window.dataLayer) return;
  const cleanPath = pathname.split('?')[0]?.split('#')[0]?.slice(0, 256) || '/';
  window.dataLayer.push({
    // GTM's version-2 data model merges pushes. Clear absent dimensions so a
    // later page view cannot inherit a signup method or another CTA's source.
    ...Object.fromEntries(GTM_OPTIONAL_EVENT_FIELDS.map((key) => [key, null])),
    ...properties,
    event: GTM_MARKETING_EVENT,
    event_name: eventName,
    page_location: new URL(cleanPath, window.location.origin).href,
    page_path: cleanPath,
  });
};

const consentState = (granted: boolean) => ({
  ad_personalization: 'denied',
  ad_storage: 'denied',
  ad_user_data: 'denied',
  analytics_storage: granted ? 'granted' : 'denied',
});

const sameTarget = (left: MarketingAnalyticsTarget | null, right: MarketingAnalyticsTarget): boolean =>
  left?.provider === right.provider && left.id === right.id;

const validTarget = (target: MarketingAnalyticsTarget): boolean =>
  target.provider === 'gtm' ? isGtmContainerId(target.id) : target.provider === 'ga4' && isGa4MeasurementId(target.id);

/** GTM remains the only loader. Its public GA destination is also needed for
 * Google's supported collection opt-out, which Consent Mode alone does not do.
 * Script IDs cover older metadata responses that omitted the destination. */
function setDestinationDisabled(target: MarketingAnalyticsTarget, disabled: boolean): void {
  const ids = new Set([target.provider === 'ga4' ? target.id : target.ga4MeasurementId]);
  if (target.provider === 'gtm' && !isGa4MeasurementId(target.ga4MeasurementId)) {
    for (const script of document.querySelectorAll<HTMLScriptElement>('script[src]')) {
      const url = new URL(script.src, window.location.origin);
      if (url.hostname === 'www.googletagmanager.com' && (url.pathname === '/gtag/js' || url.pathname === '/gtag/destination')) {
        const id = url.searchParams.get('id');
        if (isGa4MeasurementId(id)) ids.add(id);
      }
    }
  }
  for (const id of ids) if (isGa4MeasurementId(id)) window[`ga-disable-${id}`] = disabled;
}

function setPublicPageContext(pathname = window.location.pathname): void {
  const cleanPath = pathname.split('?')[0]?.split('#')[0]?.slice(0, 256) || '/';
  let referrer = '';
  try {
    const url = new URL(document.referrer);
    referrer = `${url.origin}${url.pathname}`;
  } catch {
    // An absent referrer is normal for direct navigation.
  }
  getGtag()('set', { page_location: new URL(cleanPath, window.location.origin).href, page_referrer: referrer });
}

function flushPendingEvents(target: MarketingAnalyticsTarget): true {
  for (const pending of pendingEvents.splice(0)) {
    if (readMarketingAnalyticsConsent() !== 'accepted') break;
    if (target.provider === 'gtm') pushGtmMarketingEvent(pending.event, pending.properties, pending.pathname);
    else
      window.gtag?.('event', pending.event, {
        ...pending.properties,
        page_location: new URL(pending.pathname, window.location.origin).href,
        send_to: target.id,
      });
  }
  return true;
}

export function initializeMarketingAnalytics(target: MarketingAnalyticsTarget): boolean {
  if (typeof document === 'undefined' || typeof window === 'undefined' || !validTarget(target) || readMarketingAnalyticsConsent() !== 'accepted')
    return false;
  const wasActive = sameTarget(activeTarget, target);
  if (activeTarget?.provider === 'ga4' && !sameTarget(activeTarget, target)) window[`ga-disable-${activeTarget.id}`] = true;
  activeTarget = target;
  setDestinationDisabled(target, false);
  const gtag = getGtag();
  setPublicPageContext();
  if (!wasActive) gtag('consent', 'default', consentState(false));
  gtag('consent', 'update', consentState(true));

  if (target.provider === 'gtm') {
    const elementId = 'nibleaf-marketing-gtm';
    if (document.getElementById(elementId)) return flushPendingEvents(target);
    window.dataLayer?.push({ 'gtm.start': Date.now(), event: 'gtm.js' });
    const script = document.createElement('script');
    script.id = elementId;
    script.async = true;
    script.src = `https://www.googletagmanager.com/gtm.js?id=${encodeURIComponent(target.id)}`;
    const nonce = responseNonce();
    if (nonce) script.nonce = nonce;
    document.head.appendChild(script);
    return flushPendingEvents(target);
  }

  const elementId = 'nibleaf-marketing-ga4';
  if (document.getElementById(elementId)) return flushPendingEvents(target);
  gtag('js', new Date());
  gtag('config', target.id, { anonymize_ip: true, cookie_domain: 'none', send_page_view: false });
  const script = document.createElement('script');
  script.id = elementId;
  script.async = true;
  script.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(target.id)}`;
  const nonce = responseNonce();
  if (nonce) script.nonce = nonce;
  document.head.appendChild(script);
  return flushPendingEvents(target);
}

export function suspendMarketingAnalytics(target: MarketingAnalyticsTarget): void {
  if (typeof window === 'undefined' || !validTarget(target)) return;
  setDestinationDisabled(target, true);
  if (sameTarget(activeTarget, target)) activeTarget = null;
  pendingEvents.length = 0;
  window.gtag?.('consent', 'update', consentState(false));
}

/** Build deletion cookies for host-only and domain-scoped GA cookies. Parent
 * scopes stop at the registrable domain from the Public Suffix List, including
 * private suffixes such as github.io, so withdrawal never targets a public or
 * unrelated domain. */
export function marketingAnalyticsCookieExpirations(cookieHeader: string, hostname: string): string[] {
  const names = [
    ...new Set(
      cookieHeader
        .split(';')
        .map((part) => part.split('=')[0]?.trim())
        .filter((name): name is string => Boolean(name && /^_ga(?:_|$)/u.test(name))),
    ),
  ];
  const normalizedHostname = hostname.trim().toLowerCase().replace(/\.$/u, '');
  const registrableDomain = normalizedHostname ? getDomain(normalizedHostname, { allowPrivateDomains: true }) : null;
  const domainScopes: string[] = [];
  if (registrableDomain && (normalizedHostname === registrableDomain || normalizedHostname.endsWith(`.${registrableDomain}`))) {
    let scope = normalizedHostname;
    while (scope) {
      domainScopes.push(scope);
      if (scope === registrableDomain) break;
      scope = scope.slice(scope.indexOf('.') + 1);
    }
  }

  return names.flatMap((name) => {
    const expiration = `${name}=; Max-Age=0; Path=/; SameSite=Lax`;
    return [expiration, ...domainScopes.map((domain) => `${expiration}; Domain=${domain}`)];
  });
}

export function declineMarketingAnalytics(target: MarketingAnalyticsTarget): void {
  suspendMarketingAnalytics(target);
  persistMarketingAnalyticsConsent('declined');
  if (typeof document === 'undefined') return;
  for (const expiration of marketingAnalyticsCookieExpirations(document.cookie, window.location.hostname)) {
    // biome-ignore lint/suspicious/noDocumentCookie: Cookie Store is not yet universal; withdrawal must expire GA cookies synchronously.
    document.cookie = expiration;
  }
}

export function sendMarketingPageView(pathname: string, language: MarketingAnalyticsLanguage): void {
  if (
    typeof window === 'undefined' ||
    typeof document === 'undefined' ||
    !activeTarget ||
    !pathname.startsWith('/') ||
    !marketingAnalyticsEnabled(pathname) ||
    readMarketingAnalyticsConsent() !== 'accepted'
  )
    return;
  const cleanPath = pathname.split('?')[0]?.split('#')[0]?.slice(0, 256) || '/';
  setPublicPageContext(cleanPath);
  const properties = {
    language,
    page_location: new URL(cleanPath, window.location.origin).href,
    page_path: cleanPath,
    page_title: document.title.slice(0, 200),
  };
  if (activeTarget.provider === 'gtm') {
    pushGtmMarketingEvent('page_view', properties, cleanPath);
    return;
  }
  window.gtag?.('event', 'page_view', { ...properties, send_to: activeTarget.id });
}

export function sendMarketingAnalyticsEvent(event: string, properties: Record<string, boolean | number | string>): void {
  if (
    typeof window === 'undefined' ||
    !marketingAnalyticsEnabled(window.location.pathname) ||
    !isApprovedMarketingAnalyticsEvent(event, properties) ||
    readMarketingAnalyticsConsent() !== 'accepted'
  )
    return;
  if (!activeTarget) {
    if (pendingEvents.length < 20) pendingEvents.push({ event, properties, pathname: window.location.pathname });
    return;
  }
  if (activeTarget.provider === 'gtm') {
    pushGtmMarketingEvent(event, properties);
    return;
  }
  window.gtag?.('event', event, {
    ...properties,
    page_location: new URL(window.location.pathname, window.location.origin).href,
    send_to: activeTarget.id,
  });
}

export function sendMarketingCtaEvent(input: {
  destination: MarketingCtaDestination;
  language: MarketingAnalyticsLanguage;
  placement: MarketingCtaPlacement;
}): void {
  if (typeof window === 'undefined' || !CTA_DESTINATIONS.has(input.destination) || !CTA_PLACEMENTS.has(input.placement)) return;
  sendMarketingAnalyticsEvent('cta_clicked', {
    destination: input.destination,
    language: input.language,
    page_path: window.location.pathname.slice(0, 256),
    placement: input.placement,
  });
}
