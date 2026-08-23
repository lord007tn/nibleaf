import { useMutation } from '@tanstack/react-query';
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

interface SiteAnalyticsEvent {
  eventId: string;
  occurredAt: string;
  consentState: SiteAnalyticsConsent;
  sessionId?: string;
  payload: PublicAnalyticsPayload;
}

export const useCreateSiteAnalyticsEvent = (projectId: string) =>
  useMutation({
    mutationFn: async (event: SiteAnalyticsEvent) => {
      const response = await api.public.sites[':id'].events.$post({ param: { id: projectId }, json: event });
      if (!response.ok) {
        throw new Error('Could not record the analytics event.');
      }
    },
  });
