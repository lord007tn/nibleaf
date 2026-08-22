export const MARKETING_ANALYTICS_CONSENT_KEY = 'nibleaf.marketing.analytics.consent.v1';

export type MarketingAnalyticsConsent = 'accepted' | 'declined' | 'pending';
export type MarketingAnalyticsLanguage = 'ar' | 'en';
export type MarketingCtaDestination = 'comparison' | 'contact' | 'docs' | 'pricing' | 'rtl_guide' | 'rtl_tool' | 'self_hosting' | 'signup';
export type MarketingCtaPlacement = 'final' | 'header' | 'hero' | 'resource_bridge';

type Gtag = (...args: unknown[]) => void;

declare global {
  interface Window {
    dataLayer?: unknown[][];
    gtag?: Gtag;
    [key: `ga-disable-${string}`]: boolean | undefined;
  }
}

const GA4_ID = /^G-[A-Z0-9]{6,}$/u;
let activeMeasurementId: string | null = null;
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

export const isGa4MeasurementId = (value: unknown): value is string => typeof value === 'string' && GA4_ID.test(value) && !/^G-X+$/u.test(value);

export const readMarketingAnalyticsConsent = (): MarketingAnalyticsConsent => {
  if (typeof window === 'undefined') return 'pending';
  const stored = window.localStorage.getItem(MARKETING_ANALYTICS_CONSENT_KEY);
  return stored === 'accepted' || stored === 'declined' ? stored : 'pending';
};

export const persistMarketingAnalyticsConsent = (choice: Exclude<MarketingAnalyticsConsent, 'pending'>): void => {
  window.localStorage.setItem(MARKETING_ANALYTICS_CONSENT_KEY, choice);
};

const responseNonce = (): string | undefined => document.querySelector<HTMLMetaElement>('meta[property="csp-nonce"]')?.content || undefined;

const getGtag = (): Gtag => {
  window.dataLayer ??= [];
  window.gtag ??= (...args: unknown[]) => {
    window.dataLayer?.push(args);
  };
  return window.gtag;
};

const consentState = (granted: boolean) => ({
  ad_personalization: 'denied',
  ad_storage: 'denied',
  ad_user_data: 'denied',
  analytics_storage: granted ? 'granted' : 'denied',
});

export function initializeMarketingAnalytics(measurementId: string): boolean {
  if (typeof document === 'undefined' || typeof window === 'undefined' || !isGa4MeasurementId(measurementId)) return false;
  if (activeMeasurementId && activeMeasurementId !== measurementId) window[`ga-disable-${activeMeasurementId}`] = true;
  activeMeasurementId = measurementId;
  window[`ga-disable-${measurementId}`] = false;
  const gtag = getGtag();
  gtag('consent', 'default', consentState(false));
  gtag('consent', 'update', consentState(true));
  gtag('js', new Date());
  gtag('config', measurementId, { anonymize_ip: true, cookie_domain: 'none', send_page_view: false });

  const id = 'nibleaf-marketing-ga4';
  if (!document.getElementById(id)) {
    const script = document.createElement('script');
    script.id = id;
    script.async = true;
    script.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(measurementId)}`;
    const nonce = responseNonce();
    if (nonce) script.nonce = nonce;
    document.head.appendChild(script);
  }
  return true;
}

export function suspendMarketingAnalytics(measurementId: string): void {
  if (typeof window === 'undefined' || !isGa4MeasurementId(measurementId)) return;
  window[`ga-disable-${measurementId}`] = true;
  if (activeMeasurementId === measurementId) activeMeasurementId = null;
}

export function declineMarketingAnalytics(measurementId: string): void {
  persistMarketingAnalyticsConsent('declined');
  suspendMarketingAnalytics(measurementId);
  window.gtag?.('consent', 'update', consentState(false));
  if (typeof document === 'undefined') return;
  for (const part of document.cookie.split(';')) {
    const name = part.split('=')[0]?.trim();
    if (!name || !/^_ga(?:_|$)/u.test(name)) continue;
    // biome-ignore lint/suspicious/noDocumentCookie: Cookie Store is not yet universal; withdrawal must expire GA cookies synchronously.
    document.cookie = `${name}=; Max-Age=0; Path=/; SameSite=Lax`;
  }
}

export function sendMarketingPageView(pathname: string, language: MarketingAnalyticsLanguage): void {
  if (typeof window === 'undefined' || typeof document === 'undefined' || !window.gtag || !activeMeasurementId || !pathname.startsWith('/')) return;
  const cleanPath = pathname.split('?')[0]?.split('#')[0]?.slice(0, 256) || '/';
  window.gtag('event', 'page_view', {
    language,
    page_location: new URL(cleanPath, window.location.origin).href,
    page_path: cleanPath,
    page_title: document.title.slice(0, 200),
    send_to: activeMeasurementId,
  });
}

export function sendMarketingAnalyticsEvent(event: string, properties: Record<string, boolean | number | string>): void {
  if (typeof window === 'undefined' || !window.gtag || !activeMeasurementId || !/^[a-z][a-z0-9_]{1,39}$/u.test(event)) return;
  window.gtag('event', event, { ...properties, send_to: activeMeasurementId });
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
