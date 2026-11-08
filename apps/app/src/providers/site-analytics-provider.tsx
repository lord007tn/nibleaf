import { analyticsConsentPolicy } from '@nibleaf/shared/analytics-consent';
import type { ProjectConfig } from '@nibleaf/validators';
import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useRef } from 'react';
import { type PublicAnalyticsPayload, type SiteAnalyticsConsent, useCreateSiteAnalyticsEvent } from '@/hooks/api/site-events';
import { readSiteConsent } from '@/lib/site-consent';
import { readSiteStorage, writeSiteStorage } from '@/lib/site-storage';
import { collectSiteWebVitals } from '@/lib/site-web-vitals';

export type { PublicAnalyticsPayload, SiteAnalyticsConsent } from '@/hooks/api/site-events';

const viewedDocuments = new WeakSet<Document>();
const replayedViews = new WeakMap<Document, string>();
const activeVitals = new WeakMap<Document, { key: string; pending: boolean; stop: () => void }>();
const vitalDocuments = new WeakSet<Document>();

const randomIdFn = (): string => {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const words = new Uint32Array(4);
  crypto.getRandomValues(words);
  return Array.from(words, (value) => value.toString(36)).join('.');
};

const sessionIdFn = (): string | undefined => {
  if (typeof window === 'undefined') return undefined;
  const key = 'nibleaf.sid';
  let id = readSiteStorage('sessionStorage', key);
  if (!id) {
    id = randomIdFn();
    // Omit session identity when it cannot be kept stable for this session.
    if (!writeSiteStorage('sessionStorage', key, id)) return undefined;
  }
  return id;
};

const consentStateFn = (projectId: string, config?: ProjectConfig | null): SiteAnalyticsConsent => {
  const policy = analyticsConsentPolicy(config);
  if (policy === 'blocked') return 'denied';
  if (policy === 'not_required') return 'not_required';
  if (typeof window === 'undefined') return 'unknown';
  const value = readSiteConsent(projectId);
  return value === 'accepted' ? 'granted' : value === 'declined' ? 'denied' : 'unknown';
};

const searchIdentityReaders = new Map<string, () => { consentState: SiteAnalyticsConsent; sessionId?: string }>();
/** Search uses the mounted reader's live consent policy. Absent providers (SSR,
 * tests, or a blocked storage API) never assume permission to identify a visit. */
export const getSiteSearchAnalytics = (projectId: string) => searchIdentityReaders.get(projectId)?.() ?? { consentState: 'unknown' as const };

type SiteAnalyticsContextValue = { track: (payload: PublicAnalyticsPayload) => void };
const SiteAnalyticsContext = createContext<SiteAnalyticsContextValue | null>(null);

export function SiteAnalyticsProvider({
  children,
  projectId,
  path,
  language,
  version,
  config,
}: {
  children: ReactNode;
  projectId: string;
  path: string;
  language?: string;
  version?: string;
  config?: ProjectConfig | null;
}) {
  const { mutate: createEvent } = useCreateSiteAnalyticsEvent(projectId);
  const configRef = useRef(config);
  useEffect(() => {
    configRef.current = config;
  }, [config]);
  useEffect(() => {
    const identity = () => {
      const consentState = consentStateFn(projectId, configRef.current);
      return { consentState, sessionId: consentState === 'granted' || consentState === 'not_required' ? sessionIdFn() : undefined };
    };
    searchIdentityReaders.set(projectId, identity);
    return () => {
      if (searchIdentityReaders.get(projectId) === identity) searchIdentityReaders.delete(projectId);
    };
  }, [projectId]);
  const track = useCallback(
    (payload: PublicAnalyticsPayload) => {
      createEvent({
        eventId: randomIdFn(),
        occurredAt: new Date().toISOString(),
        consentState: consentStateFn(projectId, configRef.current),
        sessionId: ['granted', 'not_required'].includes(consentStateFn(projectId, configRef.current)) ? sessionIdFn() : undefined,
        payload,
      });
    },
    [createEvent, projectId],
  );

  useEffect(() => {
    if (!path) return;
    // React can unmount and immediately remount the same effect in one task
    // (StrictMode does this in development). That replay is not a new view.
    const viewKey = `${projectId}|${path}|${version ?? ''}|${language ?? ''}`;
    const forget = () => {
      replayedViews.set(document, viewKey);
      queueMicrotask(() => {
        if (replayedViews.get(document) === viewKey) replayedViews.delete(document);
      });
    };
    if (replayedViews.get(document) === viewKey) {
      replayedViews.delete(document);
      return forget;
    }
    const referrer = viewedDocuments.has(document) ? undefined : document.referrer || undefined;
    viewedDocuments.add(document);
    const campaign = new URLSearchParams(window.location.search);
    track({ name: 'page_view', path, referrer, language, utmSource: campaign.get('utm_source')?.slice(0, 120) || undefined });
    return forget;
  }, [language, path, projectId, track, version]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: engagement belongs to one version of the page.
  useEffect(() => {
    if (!path) return;
    const started = performance.now();
    let sent = false;
    let scrollDepth = 0;
    const measureScroll = () => {
      const scrollable = Math.max(1, document.documentElement.scrollHeight - window.innerHeight);
      scrollDepth = Math.max(scrollDepth, Math.min(100, Math.max(0, Math.round((window.scrollY / scrollable) * 100))));
    };
    measureScroll();
    window.addEventListener('scroll', measureScroll, { passive: true });
    window.addEventListener('resize', measureScroll);
    const sendEngagement = () => {
      if (sent) return;
      const engagementMs = Math.round(performance.now() - started);
      if (engagementMs < 1000) return;
      sent = true;
      track({ name: 'page_engaged', path, language, engagementMs, scrollDepth });
    };
    const onVisibility = () => document.visibilityState === 'hidden' && sendEngagement();
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', sendEngagement);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', sendEngagement);
      window.removeEventListener('scroll', measureScroll);
      window.removeEventListener('resize', measureScroll);
      sendEngagement();
    };
  }, [language, path, track, version]);

  // Native navigation metrics describe document loads. Soft route changes emit
  // optional vitals (unknown values), rather than relabeling the old document's LCP.
  useEffect(() => {
    if (!path) return;
    const key = `${projectId}|${path}|${language ?? ''}`;
    const running = activeVitals.get(document);
    if (running?.pending && running.key === key) {
      // An immediate replay of the same view (StrictMode) keeps the running collector.
      running.pending = false;
    } else {
      const initial = !vitalDocuments.has(document);
      vitalDocuments.add(document);
      activeVitals.set(document, {
        key,
        pending: false,
        stop: collectSiteWebVitals((vitals) => track({ name: 'web_vitals', path, language, ...vitals }), initial),
      });
    }
    return () => {
      const entry = activeVitals.get(document);
      if (entry?.key !== key) return;
      // Stop (and report) at the end of this task unless the same view is replayed first.
      entry.pending = true;
      queueMicrotask(() => {
        if (!entry.pending) return;
        if (activeVitals.get(document) === entry) activeVitals.delete(document);
        entry.stop();
      });
    };
  }, [path, language, projectId, track]);

  useEffect(() => {
    if (!path) return;
    const onClick = (event: MouseEvent) => {
      const anchor = event.target instanceof Element ? event.target.closest('a[href]') : null;
      if (!(anchor instanceof HTMLAnchorElement)) return;
      let target: URL;
      try {
        target = new URL(anchor.href, window.location.href);
      } catch {
        return;
      }
      const isOutbound = target.origin !== window.location.origin;
      track({
        name: isOutbound ? 'outbound_link_clicked' : anchor.dataset.analyticsCta !== undefined ? 'cta_clicked' : 'navigation_clicked',
        path,
        targetPath: isOutbound ? target.hostname : target.pathname,
        placement: anchor.dataset.analyticsPlacement?.slice(0, 120),
        language,
      });
    };
    const onCopy = () => {
      const selectionNode = window.getSelection()?.anchorNode;
      const element = selectionNode instanceof Element ? selectionNode : selectionNode?.parentElement;
      if (element?.closest('pre, code')) track({ name: 'code_copied', path, placement: 'document', language });
    };
    document.addEventListener('click', onClick);
    document.addEventListener('copy', onCopy);
    return () => {
      document.removeEventListener('click', onClick);
      document.removeEventListener('copy', onCopy);
    };
  }, [language, path, track]);

  const value = useMemo(() => ({ track }), [track]);
  return <SiteAnalyticsContext value={value}>{children}</SiteAnalyticsContext>;
}

export function useSiteAnalytics(): SiteAnalyticsContextValue {
  const value = useContext(SiteAnalyticsContext);
  if (!value) throw new Error('useSiteAnalytics must be used within SiteAnalyticsProvider');
  return value;
}
