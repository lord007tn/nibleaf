import { cn } from '@nibleaf/design-system/lib/utils';
import { initials } from './switcher-model';

/** An organization's logo, or its initials on a tinted square. Decorative: the name is always next to it. */
export function OrgAvatar({ name, logo, className }: { name: string; logo: string | null | undefined; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        'grid size-6 shrink-0 place-items-center overflow-hidden rounded-md border border-border bg-primary/10 font-semibold text-[10px] text-primary',
        className,
      )}
    >
      {logo ? <img alt="" className="size-full object-cover" src={logo} /> : initials(name)}
    </span>
  );
}
