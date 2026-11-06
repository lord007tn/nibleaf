import { siteT } from '@nibleaf/i18n/site';
import { ExternalLink, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { readSiteStorage, writeSiteStorage } from '@/lib/site-storage';

export interface SiteBannerConfig {
  enabled?: boolean;
  message?: string;
  linkLabel?: string;
  linkUrl?: string;
  dismissible?: boolean;
}

/** JSON for an inline script: also escapes `<`, so a message can never close the tag. */
const inlineJson = (value: string): string =>
  JSON.stringify(value).replaceAll('<', '\\u003c').replaceAll('\u2028', '\\u2028').replaceAll('\u2029', '\\u2029');

/** Runs while the HTML is still parsing, right after the banner element: a
 * reader who already dismissed this message never sees it paint (and the
 * header never jumps when it disappears). It only sets `hidden`, which the
 * banner tolerates during hydration. Scripts React inserts on the client never
 * execute, so it is inert after the first page load. */
export const bannerDismissedScript = (storageKey: string): string =>
  `(function(){try{var s=document.currentScript,b=s&&s.previousElementSibling;if(b&&localStorage.getItem(${inlineJson(storageKey)})==='1')b.setAttribute('hidden','')}catch(_){}})();`;

/**
 * Dismissible announcement banner shown above the site header. Driven by
 * `config.banner`. Dismissal is remembered per-project (and per-message) in
 * localStorage so it doesn't reappear on every navigation. Renders nothing when
 * the banner is disabled or has no message.
 */
export function SiteBanner({
  projectId,
  banner,
  lang,
  nonce,
}: {
  projectId: string;
  banner: SiteBannerConfig | undefined;
  lang?: string;
  /** CSP nonce for the server-rendered pre-paint script. */
  nonce?: string;
}) {
  const t = siteT(lang);
  const message = banner?.message?.trim();
  const dismissible = banner?.dismissible !== false;
  const storageKey = `nibleaf.banner.${projectId}.${message ?? ''}`;
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (!banner?.enabled || !message || !dismissible) {
      return;
    }
    setDismissed(readSiteStorage('localStorage', storageKey) === '1');
  }, [banner?.enabled, message, storageKey, dismissible]);

  if (!banner?.enabled || !message || (dismissible && dismissed)) {
    return null;
  }

  const dismiss = () => {
    setDismissed(true);
    writeSiteStorage('localStorage', storageKey, '1');
  };

  return (
    <>
      <div
        className="flex items-center justify-center gap-3 border-border border-b bg-primary px-6 py-2 text-center text-primary-foreground text-sm"
        data-theme-region="banner"
        // The pre-paint script may add `hidden` before hydration; the effect above
        // then removes the banner for good, so the attribute difference is expected.
        suppressHydrationWarning
      >
        {/* Authored text keeps its own direction (an English notice on an Arabic site). */}
        <span className="font-medium" dir="auto">
          {message}
        </span>
        {banner.linkUrl ? (
          <a
            href={banner.linkUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex cursor-pointer items-center gap-1 font-semibold underline underline-offset-4 hover:opacity-90"
          >
            <span dir="auto">{banner.linkLabel ?? t('viewDetails')}</span>
            <ExternalLink className="size-3" aria-hidden />
          </a>
        ) : null}
        {dismissible ? (
          <button
            type="button"
            onClick={dismiss}
            aria-label={t('dismissBanner')}
            // 44px touch target; the negative block margin keeps the strip slim.
            className="-my-2 -me-4 grid size-11 shrink-0 cursor-pointer place-items-center rounded-md opacity-80 transition-opacity hover:opacity-100"
          >
            <X className="size-4" aria-hidden />
          </button>
        ) : null}
      </div>
      {/* Rendered identically on server and client so hydration lines up; browsers
          blank the nonce attribute after parsing, hence the suppressed warning. */}
      {dismissible ? (
        <script
          nonce={nonce}
          suppressHydrationWarning
          // biome-ignore lint/security/noDangerouslySetInnerHtml: the only input is a JSON-escaped storage key.
          dangerouslySetInnerHTML={{ __html: bannerDismissedScript(storageKey) }}
        />
      ) : null}
    </>
  );
}
