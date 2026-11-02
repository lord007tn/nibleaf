import type { ProjectConfig } from '@nibleaf/validators';
import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useRef } from 'react';
import { type PublicAnalyticsPayload, type SiteAnalyticsConsent, useCreateSiteAnalyticsEvent } from '@/hooks/api/site-events';
import { readSiteStorage, writeSiteStorage } from '@/lib/site-storage';

export type { PublicAnalyticsPayload, SiteAnalyticsConsent } from '@/hooks/api/site-events';

const viewedDocuments = new WeakSet<Document>();

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
  if (config?.addons?.consentBanner?.enabled === false) return 'denied';
  if (!config?.analytics?.cookieConsent) return 'not_required';
  if (typeof window === 'undefined') return 'unknown';
  const value = readSiteStorage('localStorage', `nibleaf.analytics.consent.${projectId}`);
  return value === 'accepted' ? 'granted' : value === 'declined' ? 'denied' : 'unknown';
};

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
  const track = useCallback(
    (payload: PublicAnalyticsPayload) => {
      createEvent({
        eventId: randomIdFn(),
        occurredAt: new Date().toISOString(),
        consentState: consentStateFn(projectId, configRef.current),
        sessionId: sessionIdFn(),
        payload,
      });
    },
    [createEvent, projectId],
  );

  // biome-ignore lint/correctness/useExhaustiveDependencies: another version is a distinct view of the same path.
  useEffect(() => {
    if (!path) return;
    const referrer = viewedDocuments.has(document) ? undefined : document.referrer || undefined;
    viewedDocuments.add(document);
    track({ name: 'page_view', path, referrer, language });
  }, [language, path, track, version]);

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
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('scroll', measureScroll);
      window.removeEventListener('resize', measureScroll);
      sendEngagement();
    };
  }, [language, path, track, version]);

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
