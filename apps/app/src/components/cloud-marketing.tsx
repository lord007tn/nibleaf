import { useRouter } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import { shellEn } from './marketing/copy/shell.en';
import { marketingCounterpart } from './marketing/routes';
import { MarketingSiteShell } from './marketing/site/marketing-site-shell';

export { GitHubStarLink } from './marketing/site/github-star-link';
export { Eyebrow, iconTile, invertedOutlineButton, outlineButton, primaryButton } from './marketing/site/primitives';

export function MarketingShell({ children, stars = 0 }: { children: ReactNode; stars?: number }) {
  // "العربية" opens this page in Arabic when the site has it, else the Arabic home
  // (MKT-002). Outside a router (tests, previews) it is the Arabic home.
  const pathname = useRouter({ warn: false })?.state.location.pathname;
  return (
    <MarketingSiteShell lang="en" copy={shellEn} alternateHref={(pathname && marketingCounterpart(pathname)) || '/ar'} stars={stars}>
      {children}
    </MarketingSiteShell>
  );
}
