import { useEffect, useMemo, useState } from 'react';
import type { ProjectConfig } from '@/hooks/api/types';
import { siteT } from '@/lib/site-i18n';
import { analyticsScripts } from '@/lib/site-seo';

const consentKey = (projectId: string) => `nibleaf.analytics.consent.${projectId}`;

/** Read the persisted consent choice; anything other than a stored accept/decline
 *  is treated as still pending (so the banner shows). */
const readConsent = (projectId: string): 'pending' | 'accepted' | 'declined' => {
  const stored = window.localStorage.getItem(consentKey(projectId));
  return stored === 'accepted' || stored === 'declined' ? stored : 'pending';
};

function appendAnalyticsScript(projectId: string, index: number, script: ReturnType<typeof analyticsScripts>[number]) {
  const id = `nibleaf-analytics-${projectId}-${index}`;
  if (document.getElementById(id)) {
    return;
  }
  const el = document.createElement('script');
  el.id = id;
  if (script.src) {
    el.src = script.src;
  }
  if (script.async) {
    el.async = true;
  }
  if (script.defer) {
    el.defer = true;
  }
  for (const [key, value] of Object.entries(script)) {
    if (['src', 'async', 'defer', 'children', 'type'].includes(key) || value === undefined || value === null) {
      continue;
    }
    el.setAttribute(key, String(value));
  }
  if (script.type) {
    el.type = script.type;
  }
  if (script.children) {
    el.text = script.children;
  }
  document.head.appendChild(el);
}

export function SiteAnalyticsConsent({ projectId, config, lang }: { projectId: string; config: ProjectConfig | null; lang?: string }) {
  const scripts = useMemo(() => analyticsScripts(config), [config]);
  const requiresConsent = Boolean(config?.analytics?.cookieConsent && scripts.length > 0);
  const [choice, setChoice] = useState<'pending' | 'accepted' | 'declined'>(() => {
    if (typeof window === 'undefined' || !requiresConsent) {
      return 'pending';
    }
    return readConsent(projectId);
  });
  const t = siteT(lang);

  useEffect(() => {
    if (typeof window === 'undefined' || !requiresConsent) {
      return;
    }
    setChoice(readConsent(projectId));
  }, [projectId, requiresConsent]);

  useEffect(() => {
    if (typeof document === 'undefined' || scripts.length === 0 || !requiresConsent || choice !== 'accepted') {
      return;
    }
    for (const [index, script] of scripts.entries()) {
      appendAnalyticsScript(projectId, index, script);
    }
  }, [choice, projectId, requiresConsent, scripts]);

  if (!requiresConsent || choice !== 'pending') {
    return null;
  }

  return (
    <div className="fixed end-4 bottom-4 z-50 max-w-sm rounded-lg border border-border bg-background p-4 shadow-lg">
      <p className="text-sm leading-relaxed">{t('analyticsConsentBody')}</p>
      <div className="mt-3 flex justify-end gap-2">
        <button
          className="cursor-pointer rounded-md border border-border px-3 py-1.5 text-muted-foreground text-sm transition-colors hover:bg-muted"
          type="button"
          onClick={() => {
            window.localStorage.setItem(consentKey(projectId), 'declined');
            setChoice('declined');
          }}
        >
          {t('analyticsConsentDecline')}
        </button>
        <button
          className="cursor-pointer rounded-md bg-primary px-3 py-1.5 font-medium text-primary-foreground text-sm transition-opacity hover:opacity-90"
          type="button"
          onClick={() => {
            window.localStorage.setItem(consentKey(projectId), 'accepted');
            setChoice('accepted');
          }}
        >
          {t('analyticsConsentAccept')}
        </button>
      </div>
    </div>
  );
}
