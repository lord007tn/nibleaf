import { getLocale, renderedLocale, subscribeLanguage } from '@nibleaf/i18n/locale-state';
import { useSyncExternalStore } from 'react';
import { localeTag, parseCalendarDate, useFormatters } from '@/lib/format';
import type { Delta, MetricKind } from './metrics';

/** Shown for every unknown (`null`) value: unknown is never rendered as zero. */
export const UNKNOWN = '—';

/**
 * Formatters for the insights dashboard on top of the shared locale
 * formatters: rates are 0..1 fractions, durations are milliseconds and series
 * buckets are already in the viewer's timezone.
 */
export function useInsightFormat() {
  const base = useFormatters();
  const locale = useSyncExternalStore(subscribeLanguage, getLocale, renderedLocale);
  const tag = localeTag(locale);
  const unit = (value: number, unitName: string, maximumFractionDigits = 0) =>
    new Intl.NumberFormat(tag, { style: 'unit', unit: unitName, unitDisplay: 'short', maximumFractionDigits }).format(value);

  const count = (value: number | null) => (value === null ? UNKNOWN : base.number(value));
  const rate = (value: number | null) => (value === null ? UNKNOWN : base.number(value, { style: 'percent', maximumFractionDigits: 1 }));
  /** Reading time: "42 sec", "3 min 5 sec". */
  const duration = (ms: number | null) => {
    if (ms === null) return UNKNOWN;
    const seconds = Math.round(ms / 1000);
    if (seconds < 60) return unit(seconds, 'second');
    const minutes = Math.floor(seconds / 60);
    const rest = seconds % 60;
    return rest === 0 ? unit(minutes, 'minute') : `${unit(minutes, 'minute')} ${unit(rest, 'second')}`;
  };
  /** Loading timings: "320 ms", "2.4 sec". */
  const ms = (value: number | null) => {
    if (value === null) return UNKNOWN;
    return value < 1000 ? unit(Math.round(value), 'millisecond') : unit(value / 1000, 'second', 1);
  };
  const position = (value: number | null) => (value === null ? UNKNOWN : base.number(value, { maximumFractionDigits: 1 }));
  const decimal = (value: number | null, digits = 2) => (value === null ? UNKNOWN : base.number(value, { maximumFractionDigits: digits }));

  const metric = (value: number | null, kind: MetricKind) => {
    if (kind === 'rate') return rate(value);
    if (kind === 'duration') return duration(value);
    if (kind === 'ms') return ms(value);
    if (kind === 'position') return position(value);
    return count(value);
  };

  /** "+12%", "−3.5 pts" — the sign is part of the text; the arrow and colour are added by the caller. */
  const delta = (value: Delta) => {
    if (value.mode === 'points') {
      return base.number(value.amount, { signDisplay: 'exceptZero', maximumFractionDigits: 1 });
    }
    return base.percent(value.amount);
  };

  /** Axis / tooltip label for a series bucket (`YYYY-MM-DD` or `YYYY-MM-DDTHH:00`). */
  const bucket = (value: string, granularity: 'hour' | 'day') => {
    const date = parseCalendarDate(value);
    if (Number.isNaN(date.getTime())) return value;
    if (granularity === 'hour') return new Intl.DateTimeFormat(tag, { hour: 'numeric', minute: '2-digit' }).format(date);
    return base.shortDate(date);
  };

  /** Tooltip heading for a series bucket: hourly buckets also say which day. */
  const bucketLong = (value: string, granularity: 'hour' | 'day') => {
    const date = parseCalendarDate(value);
    if (Number.isNaN(date.getTime())) return value;
    if (granularity === 'hour')
      return new Intl.DateTimeFormat(tag, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(date);
    // Month by name ("21 أكتوبر 2026", "Oct 21, 2026"): the medium date style is all digits in Arabic.
    return new Intl.DateTimeFormat(tag, { year: 'numeric', month: 'short', day: 'numeric' }).format(date);
  };

  /** A full calendar day, for range summaries ("Oct 1, 2026"). */
  const day = (value: string) => {
    const date = parseCalendarDate(value);
    return Number.isNaN(date.getTime()) ? value : base.date(date);
  };

  return { ...base, count, rate, duration, ms, position, decimal, metric, delta, bucket, bucketLong, day };
}
