import { useLocale } from '@/lib/i18n';

/**
 * Locale-aware number/date formatters bound to the dashboard's active locale.
 * Arabic uses Arabic-Indic digits (٠١٢…) to match the hand-authored Arabic
 * strings; English uses Latin digits. Centralized so every count/date renders
 * consistently with the chosen language.
 */
export function useFormatters() {
  const { locale } = useLocale();
  const tag = locale === 'ar' ? 'ar' : 'en';
  return {
    number: (value: number) => new Intl.NumberFormat(tag).format(value),
    date: (value: string | number | Date) => new Intl.DateTimeFormat(tag, { dateStyle: 'medium' }).format(new Date(value)),
    /** A signed percentage like “+12.5%” / “−4%” for trend badges. */
    percent: (value: number) =>
      new Intl.NumberFormat(tag, { signDisplay: 'exceptZero', maximumFractionDigits: 1 }).format(value / 100) + (tag === 'ar' ? '٪' : '%'),
    /** A short axis label (e.g. “Jun 23”) for time-series charts. */
    shortDate: (value: string | number | Date) => new Intl.DateTimeFormat(tag, { month: 'short', day: 'numeric' }).format(new Date(value)),
  };
}

/** Trend of a views time-series: % change of the recent half vs the older half.
 *  Returns null when there isn't enough signal to compare (avoids noisy badges). */
export function viewsTrend(series: Array<{ views: number }>): { pct: number; direction: 'up' | 'down' | 'flat' } | null {
  if (series.length < 4) {
    return null;
  }
  const mid = Math.floor(series.length / 2);
  const older = series.slice(0, mid).reduce((sum, p) => sum + p.views, 0);
  const recent = series.slice(mid).reduce((sum, p) => sum + p.views, 0);
  if (older === 0 && recent === 0) {
    return null;
  }
  if (older === 0) {
    return { pct: 100, direction: 'up' };
  }
  const pct = ((recent - older) / older) * 100;
  return { pct, direction: pct > 1 ? 'up' : pct < -1 ? 'down' : 'flat' };
}
