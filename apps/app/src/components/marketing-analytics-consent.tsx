import { siteT } from '@nibleaf/i18n/site';
import { useRouterState } from '@tanstack/react-router';
import { useEffect, useRef, useState } from 'react';
import { useGetPublicMeta } from '@/hooks/api/public';
import {
  declineMarketingAnalytics,
  initializeMarketingAnalytics,
  MARKETING_ANALYTICS_CONSENT_EVENT,
  MARKETING_ANALYTICS_CONSENT_KEY,
  type MarketingAnalyticsConsent as MarketingAnalyticsChoice,
  type MarketingAnalyticsLanguage,
  type MarketingAnalyticsTarget,
  persistMarketingAnalyticsConsent,
  readMarketingAnalyticsConsent,
  selectMarketingAnalyticsTarget,
  sendMarketingPageView,
  suspendMarketingAnalytics,
} from '@/lib/marketing-analytics';

export { marketingAnalyticsEnabled } from '@/lib/marketing-analytics';

export function MarketingAnalyticsConsent({ enabled, language }: { enabled: boolean; language: MarketingAnalyticsLanguage }) {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const [target, setTarget] = useState<MarketingAnalyticsTarget | null>(null);
  const [choice, setChoice] = useState<MarketingAnalyticsChoice>('pending');
  const [preferencesOpen, setPreferencesOpen] = useState(false);
  const lastPageView = useRef<string | null>(null);
  const t = siteT(language);
  const { data: publicMeta } = useGetPublicMeta({ enabled });

  useEffect(() => {
    if (!(enabled && publicMeta)) return;
    setTarget(selectMarketingAnalyticsTarget(publicMeta.marketingAnalytics));
    setChoice(readMarketingAnalyticsConsent());
  }, [enabled, publicMeta]);

  useEffect(() => {
    const syncChoice = () => setChoice(readMarketingAnalyticsConsent());
    const onStorage = (event: StorageEvent) => {
      if (event.key === MARKETING_ANALYTICS_CONSENT_KEY || event.key === null) syncChoice();
    };
    window.addEventListener(MARKETING_ANALYTICS_CONSENT_EVENT, syncChoice);
    window.addEventListener('storage', onStorage);
    return () => {
      window.removeEventListener(MARKETING_ANALYTICS_CONSENT_EVENT, syncChoice);
      window.removeEventListener('storage', onStorage);
    };
  }, []);

  useEffect(() => {
    if (!target) return;
    return () => suspendMarketingAnalytics(target);
  }, [target]);

  useEffect(() => {
    if (!target) return;
    if (!enabled || choice !== 'accepted') {
      lastPageView.current = null;
      suspendMarketingAnalytics(target);
      return;
    }
    if (!initializeMarketingAnalytics(target)) return;
    const pageKey = `${target.provider}:${target.id}:${pathname}:${language}`;
    if (lastPageView.current === pageKey) return;
    lastPageView.current = pageKey;
    sendMarketingPageView(pathname, language);
  }, [choice, enabled, language, pathname, target]);

  if (!enabled || !target) return null;

  if (choice !== 'pending' && !preferencesOpen) {
    return (
      <button
        className="fixed end-3 bottom-3 z-50 cursor-pointer rounded-full border border-border bg-background/95 px-3 py-1.5 text-muted-foreground text-xs shadow-sm backdrop-blur hover:text-foreground"
        onClick={() => setPreferencesOpen(true)}
        type="button"
      >
        {t('analyticsConsentManage')}
      </button>
    );
  }

  return (
    <aside
      aria-labelledby="marketing-analytics-title"
      className="fixed end-4 bottom-4 z-50 max-w-sm rounded-xl border border-border bg-background p-4 shadow-xl"
    >
      <h2 className="font-semibold text-sm" id="marketing-analytics-title">
        {t('analyticsConsentTitle')}
      </h2>
      <p className="mt-2 text-muted-foreground text-sm leading-relaxed">{t('analyticsConsentBody')}</p>
      <a className="mt-2 inline-block text-primary text-xs hover:underline" href="/privacy">
        {t('analyticsConsentPrivacy')}
      </a>
      <div className="mt-4 flex flex-wrap justify-end gap-2">
        <button
          className="cursor-pointer rounded-md border border-border px-3 py-1.5 text-muted-foreground text-sm hover:bg-muted"
          onClick={() => {
            declineMarketingAnalytics(target);
            setChoice('declined');
            setPreferencesOpen(false);
          }}
          type="button"
        >
          {t('analyticsConsentDecline')}
        </button>
        <button
          className="cursor-pointer rounded-md bg-primary px-3 py-1.5 font-medium text-primary-foreground text-sm hover:opacity-90"
          onClick={() => {
            persistMarketingAnalyticsConsent('accepted');
            setChoice('accepted');
            setPreferencesOpen(false);
          }}
          type="button"
        >
          {t('analyticsConsentAccept')}
        </button>
      </div>
    </aside>
  );
}
