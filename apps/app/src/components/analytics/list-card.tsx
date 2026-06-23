import type { ReactNode } from 'react';
import { Skeleton } from '@/components/ui/skeleton';

export interface ListItem {
  key: string;
  label: ReactNode;
  meta?: ReactNode;
  value: number;
}

/** Card holding a title and a ranked list of label/value rows. */
export function ListCard({
  title,
  items,
  empty,
  loading,
  rows = 5,
}: {
  title: string;
  items: ListItem[];
  empty: string;
  loading?: boolean;
  rows?: number;
}) {
  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <div className="mb-3 font-medium text-sm">{title}</div>
      {loading ? (
        <div className="space-y-2.5">
          {Array.from({ length: rows }, (_, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: static skeleton placeholders have no stable id
            <Skeleton key={i} className="h-5 w-full" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <p className="py-6 text-center text-muted-foreground text-sm">{empty}</p>
      ) : (
        <ul className="space-y-2.5">
          {items.map((item) => (
            <li key={item.key} className="flex items-center justify-between gap-3 text-sm">
              <span className="flex min-w-0 flex-1 items-center gap-2 truncate text-foreground/80">{item.label}</span>
              {item.meta ? <span className="shrink-0 text-muted-foreground text-xs">{item.meta}</span> : null}
              <span className="shrink-0 font-mono text-muted-foreground tabular-nums">{item.value.toLocaleString()}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
