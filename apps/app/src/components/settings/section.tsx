import { cn } from '@midad/design-system/lib/utils';
import type { ReactNode } from 'react';

/**
 * A settings panel card. Matches the dashboard's card convention
 * (`rounded-xl border border-border bg-card p-5`) used elsewhere in settings.
 */
export function SettingsSection({
  title,
  description,
  action,
  children,
  className,
}: {
  title?: ReactNode;
  description?: string;
  action?: ReactNode;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn('rounded-xl border border-border bg-card p-5', className)}>
      {(title || action) && (
        <div className="flex items-start gap-3">
          <div className="flex-1">
            {title ? <h2 className="font-medium">{title}</h2> : null}
            {description ? <p className="mt-1 text-muted-foreground text-sm">{description}</p> : null}
          </div>
          {action}
        </div>
      )}
      {children ? <div className={cn(title || action ? 'mt-4' : '')}>{children}</div> : null}
    </section>
  );
}

/** Gradient initials avatar placeholder, mirroring the sidebar's account chip. */
export function GradientAvatar({ name, className }: { name: string; className?: string }) {
  const initials =
    (name || 'U')
      .trim()
      .split(/\s+/)
      .map((part) => part[0])
      .slice(0, 2)
      .join('')
      .toUpperCase() || 'U';
  return (
    <span
      className={cn(
        'grid shrink-0 place-items-center rounded-full bg-gradient-to-br from-primary to-primary/60 font-semibold text-primary-foreground',
        className,
      )}
    >
      {initials}
    </span>
  );
}
