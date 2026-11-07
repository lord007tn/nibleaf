import type { ReactNode } from 'react';
import { type MarketingCtaDestination, type MarketingCtaPlacement, sendMarketingCtaEvent } from '@/lib/marketing-analytics';
import type { Cta, MarketingLang } from '../copy/types';

function destination(href: string): MarketingCtaDestination | undefined {
  if (href === '/sign-up') return 'signup';
  if (href === '/self-hosting') return 'self_hosting';
  if (href === '/pricing') return 'pricing';
  if (href === '/contact') return 'contact';
  if (href === 'https://docs.nibleaf.com' || href.startsWith('https://docs.nibleaf.com/')) return 'docs';
  if (href.startsWith('/compare/') || href === '/ar/documentation-platforms') return 'comparison';
  if (href === '/tools/rtl-documentation-readiness') return 'rtl_tool';
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
        if (target) sendMarketingCtaEvent({ destination: target, language: lang, placement });
      }}
    >
      {cta.label}
      {children}
    </a>
  );
}
