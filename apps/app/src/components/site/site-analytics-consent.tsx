import { Button } from '@nibleaf/design-system/components/ui/button';
import { cn } from '@nibleaf/design-system/lib/utils';
import { siteT } from '@nibleaf/i18n/site';
import { analyticsConsentPolicy } from '@nibleaf/shared/analytics-consent';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { ProjectConfig } from '@/hooks/api/types';
import { readSiteConsent, writeSiteConsent } from '@/lib/site-consent';
import { type AnalyticsScript, analyticsScripts } from '@/lib/site-seo';

export function appendAnalyticsScript(projectId: string, index: number, script: AnalyticsScript) {
  const id = `nibleaf-analytics-${projectId}-${index}`;
  if (document.getElementById(id)) {
    return;
  }
  const el = document.createElement('script');
  el.id = id;
  const nonce = document.querySelector<HTMLMetaElement>('meta[property="csp-nonce"]')?.content;
  if (nonce) {
    el.nonce = nonce;
  }
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

export function SiteAnalyticsConsent({
  projectId,
  config,
  lang,
  reloadPage = () => window.location.reload(),
}: {
  projectId: string;
  config: ProjectConfig | null;
  lang?: string;
  reloadPage?: () => void;
}) {
  const scripts = useMemo(() => analyticsScripts(config), [config]);
  const requiresConsent = analyticsConsentPolicy(config) === 'required';
  const [choice, setChoice] = useState<'pending' | 'accepted' | 'declined'>('pending');
  const [resolvedProject, setResolvedProject] = useState<string>();
  const acceptedBeforeManage = useRef(false);
  const t = siteT(lang);
  const settings = config?.addons?.consentBanner;

  useEffect(() => {
    if (typeof window === 'undefined' || !requiresConsent) {
      return;
    }
    acceptedBeforeManage.current = false;
    setChoice(readSiteConsent(projectId));
    setResolvedProject(projectId);
  }, [projectId, requiresConsent]);

  useEffect(() => {
    if (typeof document === 'undefined' || scripts.length === 0 || !requiresConsent || resolvedProject !== projectId || choice !== 'accepted') {
      return;
    }
    for (const [index, script] of scripts.entries()) {
      appendAnalyticsScript(projectId, index, script);
    }
  }, [choice, projectId, requiresConsent, scripts, resolvedProject]);

  if (!requiresConsent || resolvedProject !== projectId) {
    return null;
  }

  const persist = (next: 'accepted' | 'declined') => {
    writeSiteConsent(projectId, next);
    if ((choice === 'accepted' || acceptedBeforeManage.current) && next === 'declined') {
      reloadPage();
      return;
    }
    acceptedBeforeManage.current = false;
    setChoice(next);
  };

  if (choice !== 'pending') {
    return (
      <Button
        className="fixed end-4 bottom-4 z-40 min-h-11 pointer-coarse:min-h-11 shadow-lg"
        onClick={() => {
          acceptedBeforeManage.current = choice === 'accepted';
          setChoice('pending');
        }}
        size="sm"
        variant="outline"
      >
        {t('analyticsConsentManage')}
      </Button>
    );
  }

  const placement = settings?.placement ?? 'bottom-end';
  const presentation = settings?.presentation ?? 'comfortable';
  const buttonLayout = settings?.buttonLayout ?? 'inline';

  return (
    <section
      aria-label={t('analyticsConsentTitle')}
      aria-live="polite"
      className={cn(
        'fixed bottom-4 z-50 w-[calc(100%-2rem)] rounded-xl border border-border bg-background shadow-xl',
        placement === 'bottom-start' && 'start-4',
        placement === 'bottom-end' && 'end-4',
        placement === 'bottom-center' && 'inset-x-4 mx-auto',
        presentation === 'compact' ? 'max-w-sm p-4' : 'max-w-lg p-5',
      )}
    >
      <h2 className="font-semibold text-base">{t('analyticsConsentTitle')}</h2>
      <p className="text-sm leading-relaxed">{t('analyticsConsentBody')}</p>
      {settings?.privacyPolicyUrl && (
        <a
          className="inline-flex min-h-11 pointer-coarse:min-h-11 items-center text-sm underline underline-offset-4"
          href={settings.privacyPolicyUrl}
        >
          {t('analyticsConsentPrivacy')}
        </a>
      )}
      <div className={cn('mt-4 flex gap-2', buttonLayout === 'stacked' ? 'flex-col' : 'flex-col sm:flex-row sm:justify-end')}>
        <Button className="min-h-11 pointer-coarse:min-h-11 w-full sm:w-auto" type="button" variant="outline" onClick={() => persist('declined')}>
          {t('analyticsConsentDecline')}
        </Button>
        <Button className="min-h-11 pointer-coarse:min-h-11 w-full sm:w-auto" type="button" variant="outline" onClick={() => persist('accepted')}>
          {t('analyticsConsentAccept')}
        </Button>
      </div>
    </section>
  );
}
