import { cn } from '@nibleaf/design-system/lib/utils';
import type { ReactNode } from 'react';

/**
 * A place with nothing in it yet, said plainly: an icon, what's missing, why
 * or what to do, and at most one action. `framed` draws its own dashed border
 * for standalone use; inside a card it sits bare. Never use it for data that
 * failed to load (that's QueryErrorState) or is unknown.
 */
export function EmptyState({
  icon,
  title,
  description,
  action,
  framed = false,
  className,
}: {
  icon?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  framed?: boolean;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center px-5 py-12 text-center',
        framed && 'min-h-64 rounded-xl border border-border border-dashed',
        className,
      )}
      data-slot="empty-state"
    >
      {icon ? (
        <span aria-hidden className="mb-3 grid size-10 place-items-center rounded-full bg-muted text-muted-foreground [&_svg]:size-5">
          {icon}
        </span>
      ) : null}
      <p className="font-medium">{title}</p>
      {description ? <p className="mt-1 max-w-sm text-pretty text-muted-foreground text-sm">{description}</p> : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}
