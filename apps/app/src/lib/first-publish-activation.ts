import { MARKETING_ANALYTICS_CONSENT_EVENT, readMarketingAnalyticsConsent } from './marketing-analytics';
import { type FirstPublishSource, trackMarketingEvent } from './marketing-events';

const CONTEXT_KEY = 'nibleaf.first-publish-attribution.v1';
const MAX_CONTEXT_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const SOURCES = new Set<FirstPublishSource>(['docker_compose_guide', 'mintlify_introduction']);

export type FirstPublishStage = 'editor_entered' | 'project_entered';

type FirstPublishContext = {
  capturedAt: number;
  entry_point: 'organic_content';
  intent: 'first_publish';
  source: FirstPublishSource;
};

export type FirstPublishAttribution = Pick<FirstPublishContext, 'entry_point' | 'intent' | 'source'>;

const baseProperties = (source: FirstPublishSource) => ({
  entry_point: 'organic_content' as const,
  intent: 'first_publish' as const,
  source,
});

function parseContext(raw: string | null, now = Date.now()): FirstPublishContext | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Record<string, unknown>;
    const keys = Object.keys(value).sort().join(',');
    if (
      keys !== 'capturedAt,entry_point,intent,source' ||
      typeof value.capturedAt !== 'number' ||
      !Number.isFinite(value.capturedAt) ||
      value.capturedAt > now ||
      now - value.capturedAt > MAX_CONTEXT_AGE_MS ||
      value.entry_point !== 'organic_content' ||
      value.intent !== 'first_publish' ||
      !SOURCES.has(value.source as FirstPublishSource)
    ) {
      return null;
    }
    return value as FirstPublishContext;
  } catch {
    return null;
  }
}

function consented(): boolean {
  return typeof window !== 'undefined' && readMarketingAnalyticsConsent() === 'accepted';
}

export function trackFirstPublishLanding(source: FirstPublishSource): boolean {
  if (!consented()) return false;
  const dedupeKey = `${CONTEXT_KEY}.landing.${source}`;
  if (window.sessionStorage.getItem(dedupeKey) === 'recorded') return false;
  trackMarketingEvent('first_publish_landing_viewed', baseProperties(source));
  window.sessionStorage.setItem(dedupeKey, 'recorded');
  return true;
}

export function trackFirstPublishCta(source: FirstPublishSource): boolean {
  if (!consented()) return false;
  const context: FirstPublishContext = { capturedAt: Date.now(), ...baseProperties(source) };
  window.localStorage.setItem(CONTEXT_KEY, JSON.stringify(context));
  trackMarketingEvent('first_publish_cta_clicked', {
    ...baseProperties(source),
    destination: 'signup',
    placement: 'article_bridge',
  });
  return true;
}

/** Return the consented, privacy-minimized attribution that may accompany a
 *  user-initiated publish job. The worker records its READY receipt only after
 *  that exact job reaches the trusted terminal state. */
export function readFirstPublishAttribution(): FirstPublishAttribution | null {
  if (!consented()) return null;
  const raw = window.localStorage.getItem(CONTEXT_KEY);
  const context = parseContext(raw);
  if (!context) {
    if (raw) window.localStorage.removeItem(CONTEXT_KEY);
    return null;
  }
  return { entry_point: context.entry_point, intent: context.intent, source: context.source };
}

/** Consume attribution after the exact user-initiated deployment reaches
 *  READY. Session deduplication remains intact for earlier journey stages. */
export function completeFirstPublishAttribution(expected: FirstPublishAttribution): void {
  const context = parseContext(window.localStorage.getItem(CONTEXT_KEY));
  if (context?.entry_point === expected.entry_point && context.intent === expected.intent && context.source === expected.source) {
    window.localStorage.removeItem(CONTEXT_KEY);
  }
}

export async function recordFirstPublishStage(stage: FirstPublishStage): Promise<boolean> {
  if (!consented()) return false;
  const raw = window.localStorage.getItem(CONTEXT_KEY);
  const context = parseContext(raw);
  if (!context) {
    if (raw) window.localStorage.removeItem(CONTEXT_KEY);
    return false;
  }
  const dedupeKey = `${CONTEXT_KEY}.stage.${stage}.${context.source}`;
  if (window.sessionStorage.getItem(dedupeKey) === 'recorded') return false;
  try {
    const response = await fetch('/api/app/activation-events', {
      body: JSON.stringify({
        stage,
        properties: {
          entry_point: context.entry_point,
          intent: context.intent,
          source: context.source,
        },
      }),
      headers: { 'content-type': 'application/json' },
      keepalive: true,
      method: 'POST',
    });
    if (!response.ok) return false;
    window.sessionStorage.setItem(dedupeKey, 'recorded');
    return true;
  } catch {
    return false;
  }
}

export { CONTEXT_KEY as FIRST_PUBLISH_CONTEXT_KEY, MARKETING_ANALYTICS_CONSENT_EVENT };
