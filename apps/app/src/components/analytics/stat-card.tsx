import type { ReactNode } from 'react';
import { Skeleton } from '@/components/ui/skeleton';
import { useFormatters } from '@/lib/format';

/** Compact KPI tile: label, big value, optional leading icon. */
export function StatCard({ label, value, icon, loading }: { label: string; value: number; icon?: ReactNode; loading?: boolean }) {
  const { number } = useFormatters();
  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <div className="flex items-center gap-2 text-muted-foreground text-sm">
        {icon}
        {label}
      </div>
      {loading ? (
        <Skeleton className="mt-2 h-9 w-20" />
      ) : (
        <div className="mt-2 font-semibold text-3xl tabular-nums tracking-tight">{number(value)}</div>
      )}
    </div>
  );
}
