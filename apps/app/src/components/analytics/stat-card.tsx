import { Card, CardDescription, CardHeader, CardTitle } from '@nibleaf/design-system/components/ui/card';
import { Skeleton } from '@nibleaf/design-system/components/ui/skeleton';
import type { ReactNode } from 'react';
import { useFormatters } from '@/lib/format';

/**
 * Compact KPI tile: label, big value, optional leading icon. Same Card anatomy
 * and type scale as SectionCard (the overview tiles) so every KPI grid looks
 * identical; unlike SectionCard it accepts `null` and shows "—" when a figure
 * is unknown (e.g. analytics unavailable).
 */
export function StatCard({ label, value, icon, loading }: { label: string; value: number | null; icon?: ReactNode; loading?: boolean }) {
  const { number } = useFormatters();
  return (
    <Card className="@container/card">
      <CardHeader>
        <CardDescription className="flex items-center gap-1.5">
          {icon}
          {label}
        </CardDescription>
        {loading ? (
          <Skeleton className="mt-1 h-8 w-20" />
        ) : (
          <CardTitle className="font-semibold text-2xl tabular-nums tracking-tight @[200px]/card:text-3xl">
            {value === null ? '—' : number(value)}
          </CardTitle>
        )}
      </CardHeader>
    </Card>
  );
}
