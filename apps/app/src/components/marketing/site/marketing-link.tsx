import type { ReactNode } from 'react';
import type { MarketingCtaDestination, MarketingCtaPlacement } from '@/lib/marketing-analytics';
import type { Cta, MarketingLang } from '../copy/types';

function destination(href: string): MarketingCtaDestination | undefined {
  // Parse so query strings (`?lang=ar`) and fragments don't hide a destination.
  const url = new URL(href, 'https://nibleaf.com');
  if (url.hostname === 'docs.nibleaf.com') return 'docs';
  if (url.hostname !== 'nibleaf.com') return undefined;
  const path = url.pathname.replace(/\/+$/, '') || '/';
  if (path === '/sign-up') return 'signup';
  if (path === '/self-hosting') return 'self_hosting';
  if (path === '/pricing') return 'pricing';
  if (path === '/contact') return 'contact';
  if (path.startsWith('/compare/') || path === '/ar/documentation-platforms') return 'comparison';
  if (path === '/tools/rtl-documentation-readiness') return 'rtl_tool';
  return undefined;
}

export function MarketingLink({
  cta,
  lang,
  placement,
  className,
  children,
}: {
  cta: Cta;
  lang: MarketingLang;
  placement: MarketingCtaPlacement;
  className?: string;
  children?: ReactNode;
}) {
  return (
    <a
      href={cta.href}
      className={className}
      onClick={() => {
        const target = destination(cta.href);
        if (!target) return;
        // Loaded on demand: the analytics module carries a public-suffix list that must
        // not weigh on first load. Marketing pages already fetch it after hydration when
        // analytics is on, so the import usually resolves from cache.
        void import('@/lib/marketing-analytics')
          .then(({ sendMarketingCtaEvent }) => sendMarketingCtaEvent({ destination: target, language: lang, placement }))
          // Analytics is best-effort: a failed chunk load must never surface as an error on navigation.
          .catch(() => undefined);
      }}
    >
      {cta.label}
      {children}
    </a>
  );
}
