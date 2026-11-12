import { cn } from '@nibleaf/design-system/lib/utils';
import { blockDirection } from '@nibleaf/shared/script-direction';
import type { ReactNode } from 'react';
import { hasIcon, PageIcon } from '@/components/site/page-icon';
import { siteEmoji } from '@/lib/site-emoji';

/** A card's icon: a known icon name, an emoji as written, or a neutral page icon
 *  for anything else (never the name's first letter, which read as a broken tile). */
function CardIcon({ icon }: { icon: string }) {
  const emoji = siteEmoji(icon);
  if (emoji) return <span className="text-lg leading-none">{emoji}</span>;
  return <PageIcon name={hasIcon(icon) ? icon : 'file-text'} className="size-5" />;
}

// ─── Cards ──────────────────────────────────────────────────────────────────

export function CardGroup({ cols, children }: { cols?: string | number; children?: ReactNode }) {
  const n = Math.min(4, Math.max(1, Number(String(cols ?? 2).replace(/[^0-9]/g, '')) || 2));
  const colsClass = { 1: 'sm:grid-cols-1', 2: 'sm:grid-cols-2', 3: 'sm:grid-cols-3', 4: 'sm:grid-cols-4' }[n];
  return <div className={cn('my-5 grid grid-cols-1 gap-4', colsClass)}>{children}</div>;
}

export function Card({ title, href, icon, children }: { title?: string; href?: string; icon?: string; children?: ReactNode }) {
  const inner = (
    <>
      {icon ? (
        <span className="mb-3 inline-flex text-primary" aria-hidden>
          <CardIcon icon={icon} />
        </span>
      ) : null}
      {title ? (
        <div className="font-semibold" dir={blockDirection(title)}>
          {title}
        </div>
      ) : null}
      {children ? <div className="mt-1.5 text-muted-foreground text-sm [&>:first-child]:mt-0 [&>:last-child]:mb-0">{children}</div> : null}
    </>
  );
  const base = 'block rounded-xl border border-border bg-card p-5 transition-all';
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
