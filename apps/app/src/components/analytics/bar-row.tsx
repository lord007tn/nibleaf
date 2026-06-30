import { ChevronRight } from 'lucide-react';
import type { ReactNode } from 'react';

/** A single label + horizontal progress bar + value row. Optionally clickable. */
export function BarRow({
  leading,
  label,
  fraction,
  value,
  color = 'var(--chart-1)',
  onClick,
}: {
  leading?: ReactNode;
  label: ReactNode;
  fraction: number;
  value: ReactNode;
  color?: string;
  onClick?: () => void;
}) {
  const Tag = onClick ? 'button' : 'div';
  return (
    <Tag
      type={onClick ? 'button' : undefined}
      onClick={onClick}
      className={`flex w-full items-center gap-3 rounded-lg px-2 py-2 text-start ${onClick ? 'cursor-pointer transition-colors hover:bg-muted/60' : ''}`}
    >
      {leading}
      <span className="w-32 shrink-0 truncate font-medium text-sm">{label}</span>
      <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
        <span className="block h-full rounded-full" style={{ width: `${Math.max(2, Math.round(fraction * 100))}%`, backgroundColor: color }} />
      </span>
      <span className="w-12 shrink-0 text-end font-mono text-muted-foreground text-xs tabular-nums">{value}</span>
      {onClick ? <ChevronRight className="size-4 shrink-0 text-muted-foreground rtl:-scale-x-100" /> : null}
    </Tag>
  );
}

