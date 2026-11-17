import { isRtlLanguage } from '@nibleaf/shared/script-direction';
import type { ReactNode } from 'react';

/**
 * A label the reader generates inside authored content ("Tab 2", "Details",
 * "Required"): it is written in the reader's language, which can differ from the
 * article's on a fallback page (Arabic chrome in an English article), so it
 * carries the reader's `lang`/`dir`. Authored titles and descriptions stay in the
 * content's language and don't use this.
 */
export function ReaderLabel({ language, children }: { language?: string; children: ReactNode }) {
  if (!language) return <>{children}</>;
  return (
    <span dir={isRtlLanguage(language) ? 'rtl' : 'ltr'} lang={language}>
      {children}
    </span>
  );
}
