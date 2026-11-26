import { useMemo } from 'react';
import { api } from '@/services/api';

export type SiteAnalyticsConsent = 'denied' | 'granted' | 'not_required' | 'unknown';
export type PublicAnalyticsPayload =
  | {
      name: 'page_view' | 'page_engaged';
      path: string;
      language?: string;
      referrer?: string;
      engagementMs?: number;
      scrollDepth?: number;
      utmSource?: string;
      utmMedium?: string;
      utmCampaign?: string;
      utmContent?: string;
      utmTerm?: string;
    }
  | {
      name: 'navigation_clicked' | 'cta_clicked' | 'outbound_link_clicked';
      path?: string;
      targetPath?: string;
      placement?: string;
      language?: string;
    }
  | { name: 'code_copied'; path?: string; placement?: string; language?: string }
  | { name: 'web_vitals'; path?: string; language?: string; lcpMs?: number; inpMs?: number; clsMilli?: number; fcpMs?: number; ttfbMs?: number }
  | { name: 'search_result_clicked'; searchId?: string; path?: string; resultId?: string; resultPosition?: number; language?: string }
  | { name: 'feedback_submitted'; path?: string; feedback: 'helpful' | 'not_helpful'; target: 'page' };

interface SiteAnalyticsEvent {
  eventId: string;
  occurredAt: string;
  consentState: SiteAnalyticsConsent;
  sessionId?: string;
  payload: PublicAnalyticsPayload;
}

/** Waits for the connection to come back before sending, as a paused mutation
 * did: an event recorded offline is sent once the reader is online again. */
const whenOnline = () =>
  typeof navigator === 'undefined' || navigator.onLine !== false
    ? Promise.resolve()
    : new Promise<void>((resolve) => window.addEventListener('online', () => resolve(), { once: true }));

/** Sends one analytics event, best effort: never retried, and a failure is
 * dropped silently (the reader never sees analytics). */
export async function sendSiteAnalyticsEvent(projectId: string, event: SiteAnalyticsEvent): Promise<void> {
  try {
    await whenOnline();
    await api.public.sites[':id'].events.$post({ param: { id: projectId }, json: event }, { init: { keepalive: true } });
  } catch {
    // Analytics never interrupt reading.
  }
}

/** The reader's analytics sender. A plain request rather than a TanStack
 * mutation: nothing reads its state, and `useMutation` would put the mutation
 * observer in every published page's first load. */
export const useCreateSiteAnalyticsEvent = (projectId: string) =>
  useMemo(() => ({ mutate: (event: SiteAnalyticsEvent) => void sendSiteAnalyticsEvent(projectId, event) }), [projectId]);
