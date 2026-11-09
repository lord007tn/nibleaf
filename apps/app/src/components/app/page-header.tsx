import { cn } from '@nibleaf/design-system/lib/utils';
import type { ReactNode } from 'react';

/**
 * The heading block every dashboard page opens with: one `h1`, a one-line
 * description and the page's primary actions. Actions wrap under the title on
 * narrow screens and stay at the end of the row otherwise, in both writing
 * directions, so every page lines up the same way.
 */
export function PageHeader({
  title,
  description,
  actions,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <header className={cn('flex flex-wrap items-start justify-between gap-x-6 gap-y-3', className)} data-slot="page-header">
      <div className="min-w-0 flex-1 basis-64">
        <h1 className="text-balance font-semibold text-2xl tracking-tight">{title}</h1>
        {description ? <p className="mt-1 max-w-prose text-pretty text-muted-foreground text-sm">{description}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </header>
  );
}
