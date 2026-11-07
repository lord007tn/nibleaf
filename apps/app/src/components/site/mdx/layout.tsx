import { cn } from '@nibleaf/design-system/lib/utils';
import { Children, isValidElement, type ReactNode } from 'react';

// ─── Layout and inline UI ────────────────────────────────────────────────────

export function Columns({ children }: { children?: ReactNode }) {
  const count = Math.min(4, Math.max(1, Children.toArray(children).filter(isValidElement).length));
  const colsClass = { 1: 'md:grid-cols-1', 2: 'md:grid-cols-2', 3: 'md:grid-cols-3', 4: 'md:grid-cols-4' }[count];
  return <div className={cn('my-5 grid grid-cols-1 gap-4', colsClass)}>{children}</div>;
}

export function Column({ children }: { children?: ReactNode }) {
  return <div className="rounded-xl border border-border bg-card p-5 [&>:first-child]:mt-0 [&>:last-child]:mb-0">{children}</div>;
}

export function Banner({ type, children }: { type?: string; children?: ReactNode }) {
  return (
    <div
      className={cn(
        'my-5 rounded-xl border px-4 py-3 text-sm',
        type === 'warning' ? 'border-amber-500/35 bg-amber-500/10' : 'border-primary/30 bg-primary/8',
      )}
    >
      {children}
    </div>
  );
}

export function Badge({ color, children }: { color?: string; children?: ReactNode }) {
  return (
    <span data-color={color} className="inline-flex rounded-full bg-muted px-2 py-0.5 font-semibold text-[0.78em] text-foreground align-middle">
      {children}
    </span>
  );
}

export function MdxButton({ href, variant, children }: { href?: string; variant?: string; children?: ReactNode }) {
  return (
    <a
      href={href}
      data-variant={variant}
      className={cn(
        'inline-flex items-center rounded-lg px-3 py-1.5 font-semibold text-sm no-underline',
        variant === 'outline' ? 'border border-border bg-card text-foreground' : 'bg-primary text-primary-foreground',
      )}
    >
      {children}
    </a>
  );
}
