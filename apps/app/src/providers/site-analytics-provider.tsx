import type { ProjectConfig } from '@nibleaf/validators';
import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo } from 'react';
import { api } from '@/services/api';

export type SiteAnalyticsConsent = 'denied' | 'granted' | 'not_required' | 'unknown';
export type PublicAnalyticsPayload =
  | { name: 'page_view' | 'page_engaged'; path: string; language?: string; referrer?: string; engagementMs?: number; scrollDepth?: number }
  | {
      name: 'navigation_clicked' | 'cta_clicked' | 'outbound_link_clicked';
      path?: string;
      targetPath?: string;
      placement?: string;
      language?: string;
    }
  | { name: 'code_copied'; path?: string; placement?: string; language?: string }
  | { name: 'search_result_clicked'; path?: string; resultId?: string; resultPosition?: number; language?: string }
  | { name: 'feedback_submitted'; path?: string; feedback: 'helpful' | 'not_helpful'; target: 'page' };

const randomIdFn = (): string => {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const words = new Uint32Array(4);
  crypto.getRandomValues(words);
  return Array.from(words, (value) => value.toString(36)).join('.');
};

const sessionIdFn = (): string | undefined => {
  if (typeof window === 'undefined') return undefined;
  const key = 'nibleaf.sid';
  let id = window.sessionStorage.getItem(key);
  if (!id) {
    id = randomIdFn();
    window.sessionStorage.setItem(key, id);
  }
  return id;
};

const consentStateFn = (projectId: string, config?: ProjectConfig | null): SiteAnalyticsConsent => {
  if (!config?.analytics?.cookieConsent) return 'not_required';
  if (typeof window === 'undefined') return 'unknown';
  const value = window.localStorage.getItem(`nibleaf.analytics.consent.${projectId}`);
  return value === 'accepted' ? 'granted' : value === 'declined' ? 'denied' : 'unknown';
};

type SiteAnalyticsContextValue = { track: (payload: PublicAnalyticsPayload) => void };
const SiteAnalyticsContext = createContext<SiteAnalyticsContextValue | null>(null);

export function SiteAnalyticsProvider({
  children,
  projectId,
  path,
  language,
  config,
}: {
  children: ReactNode;
  projectId: string;
  path: string;
  language?: string;
  config?: ProjectConfig | null;
}) {
  const track = useCallback(
    (payload: PublicAnalyticsPayload) => {
      api.public.sites[':id'].events
        .$post({
          param: { id: projectId },
          json: {
            eventId: randomIdFn(),
            occurredAt: new Date().toISOString(),
            consentState: consentStateFn(projectId, config),
            sessionId: sessionIdFn(),
            payload,
          },
        })
        .catch(() => undefined);
    },
    [config, projectId],
  );

  useEffect(() => {
    if (path) track({ name: 'page_view', path, referrer: document.referrer || undefined, language });
  }, [language, path, track]);

  useEffect(() => {
    if (!path) return;
    const started = performance.now();
    let sent = false;
    const sendEngagement = () => {
      if (sent) return;
      const engagementMs = Math.round(performance.now() - started);
      if (engagementMs < 1_000) return;
      sent = true;
      const root = document.documentElement;
      const scrollable = Math.max(1, root.scrollHeight - window.innerHeight);
      const scrollDepth = Math.min(100, Math.max(0, Math.round((window.scrollY / scrollable) * 100)));
      track({ name: 'page_engaged', path, language, engagementMs, scrollDepth });
    };
    const onVisibility = () => document.visibilityState === 'hidden' && sendEngagement();
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      sendEngagement();
    };
  }, [language, path, track]);

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
