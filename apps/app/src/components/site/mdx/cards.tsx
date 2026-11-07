import { cn } from '@nibleaf/design-system/lib/utils';
import { ArrowUpRight } from 'lucide-react';
import type { ReactNode } from 'react';
import { AuthoredIcon, isDrawableIcon } from './authored-icon';
import { authoredColor, optionalNumber, truthyAttr } from './utils';

// ─── Cards ──────────────────────────────────────────────────────────────────

const GRID_COLS = { 1: 'sm:grid-cols-1', 2: 'sm:grid-cols-2', 3: 'sm:grid-cols-3', 4: 'sm:grid-cols-4' } as const;

export function CardGroup({ cols, children }: { cols?: unknown; children?: ReactNode }) {
  const n = Math.min(4, Math.max(1, Math.round(optionalNumber(cols) ?? 2))) as keyof typeof GRID_COLS;
  return <div className={cn('my-5 grid grid-cols-1 gap-4', GRID_COLS[n])}>{children}</div>;
}

export interface CardProps {
  title?: string;
  href?: string;
  icon?: string;
  /** Compact layout: the icon sits beside the title. */
  horizontal?: unknown;
  /** Image shown across the top of the card. */
  img?: string;
  /** Call-to-action text shown at the bottom of a linked card. */
  cta?: string;
  /** Show the link arrow. */
  arrow?: unknown;
  /** Icon color. */
  color?: string;
  children?: ReactNode;
}

export function Card({ title, href, icon, horizontal, img, cta, arrow, color, children }: CardProps) {
  const isHorizontal = truthyAttr(horizontal);
  const showArrow = Boolean(href) && truthyAttr(arrow);
  const iconColor = authoredColor(color);
  const iconNode = icon ? (
    <span
      className={cn('inline-flex shrink-0 text-primary', !isHorizontal && 'mb-3')}
      style={iconColor ? { color: iconColor } : undefined}
      aria-hidden
    >
      {isDrawableIcon(icon) ? (
        <AuthoredIcon icon={icon} className="size-5" />
      ) : (
        <span className="grid size-5 place-items-center rounded-md bg-primary/10 font-mono text-[11px]">{icon[0]?.toUpperCase()}</span>
      )}
    </span>
  ) : null;
  const arrowIcon = <ArrowUpRight className="size-4 shrink-0 rtl:-scale-x-100" aria-hidden />;
  const text = (
    <>
      {title ? <div className="font-semibold">{title}</div> : null}
      {children ? <div className="mt-1.5 text-muted-foreground text-sm [&>:first-child]:mt-0 [&>:last-child]:mb-0">{children}</div> : null}
      {href && cta ? (
        <span className="mt-3 inline-flex items-center gap-1 font-medium text-primary text-sm">
          {cta}
          {showArrow ? arrowIcon : null}
        </span>
      ) : null}
    </>
  );
  const body = (
    <div className={cn('relative p-5', isHorizontal && 'flex items-start gap-3')}>
      {showArrow && !cta ? <span className="absolute end-4 top-4 text-muted-foreground">{arrowIcon}</span> : null}
      {iconNode}
      {isHorizontal ? <div className="min-w-0 flex-1">{text}</div> : text}
    </div>
  );
  const inner = (
    <>
      {/* The card's title names the image; an untitled card's image is decorative. */}
      {img ? <img src={img} alt={title ?? ''} loading="lazy" className="my-0 block aspect-[2/1] w-full rounded-none object-cover" /> : null}
      {body}
    </>
  );
  const base = 'block overflow-hidden rounded-xl border border-border bg-card transition-all';
  return href ? (
    <a data-theme-component="card" href={href} className={cn(base, 'hover:-translate-y-px hover:border-primary/50 hover:shadow-sm')}>
      {inner}
    </a>
  ) : (
    <div className={base} data-theme-component="card">
      {inner}
    </div>
  );
}
