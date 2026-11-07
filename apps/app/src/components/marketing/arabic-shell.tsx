import type { ReactNode } from 'react';
import { shellAr } from './copy/shell.ar';
import { MarketingSiteShell } from './site/marketing-site-shell';

/**
 * The Arabic marketing shell. It holds no page copy and doesn't import the
 * interface message catalog, so every page wrapped in it loads only its own
 * Arabic copy module.
 */
export function ArabicShell({ children, englishHref = '/', stars = 0 }: { children: ReactNode; englishHref?: string; stars?: number }) {
  return (
    <MarketingSiteShell lang="ar" copy={shellAr} alternateHref={englishHref} stars={stars}>
      {children}
    </MarketingSiteShell>
  );
}
