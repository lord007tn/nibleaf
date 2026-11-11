import { siteT } from '@nibleaf/i18n/site';
import type { ReactNode } from 'react';

/**
 * A deferred control's static trigger, plus what the reader needs if its code
 * didn't arrive: a short message, announced and shown under the trigger without
 * moving the header. Selecting the trigger again retries the download.
 */
export function IntentTrigger({ failed, lang, children }: { failed: boolean; lang?: string; children: ReactNode }) {
  return (
    <span className="relative inline-flex">
      {children}
      <span
        role="status"
        className={
          failed
            ? 'absolute end-0 top-full z-50 mt-1 w-max max-w-56 rounded-md border bg-popover px-2 py-1 text-popover-foreground text-xs shadow-md'
            : 'sr-only'
        }
      >
        {failed ? siteT(lang)('controlLoadFailed') : ''}
      </span>
    </span>
  );
}
