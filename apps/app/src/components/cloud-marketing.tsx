import type { ReactNode } from 'react';
import { shellEn } from './marketing/copy/shell.en';
import { MarketingSiteShell } from './marketing/site/marketing-site-shell';

export { GitHubStarLink } from './marketing/site/github-star-link';
export { Eyebrow, iconTile, invertedOutlineButton, outlineButton, primaryButton } from './marketing/site/primitives';

export function MarketingShell({ children, stars = 0 }: { children: ReactNode; stars?: number }) {
  return (
    <MarketingSiteShell lang="en" copy={shellEn} alternateHref="/ar" stars={stars}>
      {children}
    </MarketingSiteShell>
  );
}
