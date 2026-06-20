import { ExternalLink, X } from 'lucide-react';
import { useEffect, useState } from 'react';

export interface SiteBannerConfig {
  enabled?: boolean;
  message?: string;
  linkLabel?: string;
  linkUrl?: string;
  dismissible?: boolean;
}

/**
 * Dismissible announcement banner shown above the site header. Driven by
 * `config.banner`. Dismissal is remembered per-project (and per-message) in
 * localStorage so it doesn't reappear on every navigation. Renders nothing when
 * the banner is disabled or has no message (legacy snapshots).
 */
export function SiteBanner({ projectId, banner }: { projectId: string; banner: SiteBannerConfig | undefined }) {
  const message = banner?.message?.trim();
  const dismissible = banner?.dismissible !== false;
  const storageKey = `plume.banner.${projectId}.${message ?? ''}`;
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined' || !dismissible) {
      return;
    }
    setDismissed(window.localStorage.getItem(storageKey) === '1');
  }, [storageKey, dismissible]);

  if (!banner?.enabled || !message || (dismissible && dismissed)) {
    return null;
  }

  const dismiss = () => {
    setDismissed(true);
    try {
      window.localStorage.setItem(storageKey, '1');
    } catch {
      // ignore persistence failures (private mode)
    }
  };

  return (
    <div className="flex items-center justify-center gap-3 border-border border-b bg-primary px-6 py-2 text-center text-primary-foreground text-sm">
      <span className="font-medium">{message}</span>
      {banner.linkUrl ? (
        <a
          href={banner.linkUrl}
          target="_blank"
          rel="noreferrer"
          className="inline-flex cursor-pointer items-center gap-1 font-semibold underline underline-offset-4 hover:opacity-90"
        >
          {banner.linkLabel ?? 'Learn more'}
          <ExternalLink className="size-3" />
        </a>
      ) : null}
      {dismissible ? (
        <button
          type="button"
          onClick={dismiss}
          aria-label="Dismiss banner"
          className="ms-2 cursor-pointer rounded-md p-0.5 opacity-80 transition-opacity hover:opacity-100"
        >
          <X className="size-4" />
        </button>
      ) : null}
    </div>
  );
}
