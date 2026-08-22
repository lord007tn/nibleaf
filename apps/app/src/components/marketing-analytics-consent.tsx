import { useRouterState } from '@tanstack/react-router';
import { useEffect, useRef, useState } from 'react';
import {
  declineMarketingAnalytics,
  initializeMarketingAnalytics,
  isGa4MeasurementId,
  type MarketingAnalyticsConsent as MarketingAnalyticsChoice,
  type MarketingAnalyticsLanguage,
  persistMarketingAnalyticsConsent,
  readMarketingAnalyticsConsent,
  sendMarketingPageView,
  suspendMarketingAnalytics,
} from '@/lib/marketing-analytics';

interface PublicMeta {
  marketingAnalytics?: { consentRequired: true; ga4MeasurementId: string | null };
}

const copy = {
  en: {
    accept: 'Accept analytics',
    body: 'With your permission, Nibleaf uses Google Analytics to understand which public pages and calls to action are useful. We never send account content, submitted HTML, form text, or email addresses.',
    decline: 'Decline',
    manage: 'Privacy choices',
    privacy: 'Privacy policy',
    title: 'Optional analytics',
  },
  ar: {
    accept: 'قبول التحليلات',
    body: 'بعد موافقتك، تستخدم Nibleaf «إحصاءات Google» لفهم الصفحات العامة وعبارات الحث المفيدة. لا نرسل محتوى الحساب أو HTML المُدخل أو نصوص النماذج أو عناوين البريد.',
    decline: 'رفض',
    manage: 'خيارات الخصوصية',
    privacy: 'سياسة الخصوصية',
    title: 'تحليلات اختيارية',
  },
} as const;

export function marketingAnalyticsEnabled(pathname: string, siteProjectId?: string): boolean {
  if (siteProjectId) return false;
  return !['/app', '/sign-in', '/forgot-password', '/reset-password', '/verify-email', '/accept-invite', '/git-preview'].some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

export function MarketingAnalyticsConsent({ enabled, language }: { enabled: boolean; language: MarketingAnalyticsLanguage }) {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const [measurementId, setMeasurementId] = useState<string | null>(null);
  const [choice, setChoice] = useState<MarketingAnalyticsChoice>('pending');
  const lastPageView = useRef<string | null>(null);
  const t = copy[language];

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    void fetch('/api/public/meta', { cache: 'no-store' })
      .then(async (response) => (response.ok ? ((await response.json()) as { data: PublicMeta }) : null))
      .then((response) => {
        if (cancelled) return;
        const candidate = response?.data.marketingAnalytics?.ga4MeasurementId;
        setMeasurementId(isGa4MeasurementId(candidate) ? candidate : null);
        setChoice(readMarketingAnalyticsConsent());
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [enabled]);

  useEffect(() => {
    if (!measurementId) return;
    if (!enabled) {
      suspendMarketingAnalytics(measurementId);
      return;
    }
    if (choice !== 'accepted' || !initializeMarketingAnalytics(measurementId)) return;
    const pageKey = `${measurementId}:${pathname}:${language}`;
    if (lastPageView.current === pageKey) return;
    lastPageView.current = pageKey;
    sendMarketingPageView(pathname, language);
  }, [choice, enabled, language, measurementId, pathname]);

  if (!enabled || !measurementId) return null;

  if (choice !== 'pending') {
    return (
      <button
        className="fixed end-3 bottom-3 z-50 cursor-pointer rounded-full border border-border bg-background/95 px-3 py-1.5 text-muted-foreground text-xs shadow-sm backdrop-blur hover:text-foreground"
        onClick={() => setChoice('pending')}
        type="button"
      >
        {t.manage}
      </button>
    );
  }

  return (
    <aside
      aria-labelledby="marketing-analytics-title"
      className="fixed end-4 bottom-4 z-50 max-w-sm rounded-xl border border-border bg-background p-4 shadow-xl"
    >
      <h2 className="font-semibold text-sm" id="marketing-analytics-title">
        {t.title}
      </h2>
      <p className="mt-2 text-muted-foreground text-sm leading-relaxed">{t.body}</p>
      <a className="mt-2 inline-block text-primary text-xs hover:underline" href="/privacy">
        {t.privacy}
      </a>
      <div className="mt-4 flex flex-wrap justify-end gap-2">
        <button
          className="cursor-pointer rounded-md border border-border px-3 py-1.5 text-muted-foreground text-sm hover:bg-muted"
          onClick={() => {
            declineMarketingAnalytics(measurementId);
            setChoice('declined');
          }}
          type="button"
        >
          {t.decline}
        </button>
        <button
          className="cursor-pointer rounded-md bg-primary px-3 py-1.5 font-medium text-primary-foreground text-sm hover:opacity-90"
          onClick={() => {
            persistMarketingAnalyticsConsent('accepted');
            setChoice('accepted');
          }}
          type="button"
        >
          {t.accept}
        </button>
      </div>
    </aside>
  );
}
