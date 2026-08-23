import type { AnalyticsRange } from '@nibleaf/validators';
import { createContext, type ReactNode, useContext, useMemo, useState } from 'react';

type AnalyticsContextValue = {
  range: AnalyticsRange;
  setRange: (range: AnalyticsRange) => void;
  timezone: string;
};

const AnalyticsContext = createContext<AnalyticsContextValue | null>(null);

/** Shared analytics filter state. Query ownership remains in the typed TanStack
 * Query hooks, while every analytics surface consumes one range/timezone source. */
export function AnalyticsProvider({ children, defaultRange = '30d' }: { children: ReactNode; defaultRange?: AnalyticsRange }) {
  const [range, setRange] = useState<AnalyticsRange>(defaultRange);
  const timezone = useMemo(() => Intl.DateTimeFormat().resolvedOptions().timeZone, []);
  return <AnalyticsContext value={{ range, setRange, timezone }}>{children}</AnalyticsContext>;
}

export function useAnalyticsFilters(): AnalyticsContextValue {
  const value = useContext(AnalyticsContext);
  if (!value) throw new Error('useAnalyticsFilters must be used within AnalyticsProvider');
  return value;
}
