import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle } from '@nibleaf/design-system/components/ui/dialog';
import { siteT } from '@nibleaf/i18n/site';
import { useRouterState } from '@tanstack/react-router';
import { X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { OPEN_MARKETING_PRIVACY_CHOICES } from '@/components/marketing/privacy-choices';
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

export { marketingAnalyticsEnabled } from '@/lib/marketing-analytics-route';

export function MarketingAnalyticsConsent({ enabled, language }: { enabled: boolean; language: MarketingAnalyticsLanguage }) {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const [target, setTarget] = useState<MarketingAnalyticsTarget | null>(null);
  const [choice, setChoice] = useState<MarketingAnalyticsChoice>('pending');
  const [preferencesOpen, setPreferencesOpen] = useState(false);
  const preferencesTrigger = useRef<HTMLElement | null>(null);
  const lastPageView = useRef<string | null>(null);
  const t = siteT(language);
  const { data: publicMeta } = useGetPublicMeta({ enabled });

  useEffect(() => {
    if (!(enabled && publicMeta)) return;
    setTarget(selectMarketingAnalyticsTarget(publicMeta.marketingAnalytics));
    setChoice(readMarketingAnalyticsConsent());
  }, [enabled, publicMeta]);

  useEffect(() => {
    const openPreferences = (event: Event) => {
      preferencesTrigger.current =
        event instanceof CustomEvent && event.detail instanceof HTMLElement ? event.detail : (document.activeElement as HTMLElement | null);
      setPreferencesOpen(true);
    };
    window.addEventListener(OPEN_MARKETING_PRIVACY_CHOICES, openPreferences);
    return () => window.removeEventListener(OPEN_MARKETING_PRIVACY_CHOICES, openPreferences);
  }, []);

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

  if (!enabled) return null;

  return (
    <Dialog open={preferencesOpen} onOpenChange={setPreferencesOpen}>
      <DialogContent dir={language === 'ar' ? 'rtl' : 'ltr'} finalFocus={preferencesTrigger} showCloseButton={false}>
        <div className="flex items-center justify-between gap-4">
          <DialogTitle>{t('analyticsConsentTitle')}</DialogTitle>
          <DialogClose aria-label={language === 'ar' ? 'إغلاق' : 'Close'} className="grid size-10 place-items-center rounded-md hover:bg-muted">
            <X aria-hidden="true" className="size-5" />
          </DialogClose>
        </div>
        <DialogDescription>
          {target
            ? t('analyticsConsentBody')
            : language === 'ar'
              ? 'التحليلات الاختيارية غير متاحة حاليًا وتظل متوقفة.'
              : 'Optional analytics are currently unavailable and remain off.'}
        </DialogDescription>
        <a className="inline-block text-primary text-sm hover:underline" href="/privacy">
          {t('analyticsConsentPrivacy')}
        </a>
        {target && (
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
        )}
      </DialogContent>
    </Dialog>
  );
}
