import { getLocale, subscribeLanguage } from '@nibleaf/i18n/locale-state';
import { useSyncExternalStore } from 'react';

/**
 * Locale-aware number/date formatters bound to the dashboard's active locale.
 * Arabic keeps its localized words and ordering while using Western digits.
 * Centralized so every count/date renders consistently with the chosen
 * language and the product-wide 0-9 numeral convention.
 */
export function useFormatters() {
  const locale = useSyncExternalStore(subscribeLanguage, getLocale, () => 'en');
  const tag = localeTag(locale);
  return {
    number: (value: number | bigint, options?: Intl.NumberFormatOptions) => new Intl.NumberFormat(tag, options).format(value),
    /** Variables for a counted message (`{count}` with plural forms); see {@link countVariables}. */
    count: (value: number) => countVariables(locale, value),
    /** A currency amount (default USD) with the locale's symbol placement and Western digits. */
    currency: (value: number, currency = 'USD') => formatCurrency(tag, value, currency),
    /** AI spend in USD. It is often a fraction of a cent, so keep two significant
     *  digits there instead of rounding a real cost to "$0.00". */
    usd: (value: number) =>
      value > 0 && value < 0.01
        ? new Intl.NumberFormat(tag, { style: 'currency', currency: 'USD', maximumSignificantDigits: 2 }).format(value)
        : formatCurrency(tag, value, 'USD'),
    date: (value: string | number | Date) => new Intl.DateTimeFormat(tag, { dateStyle: 'medium' }).format(toDate(value)),
    /** A signed percentage like “+12.5%” / “−4%” for trend badges. `value` is
     *  already in percent units (e.g. 12.5 → “+12.5%”). `style:'percent'` lets
     *  Intl supply the locale percent sign + digits (Arabic-Indic ٪). */
    percent: (value: number) =>
      new Intl.NumberFormat(tag, { style: 'percent', signDisplay: 'exceptZero', maximumFractionDigits: 1 }).format(value / 100),
    /** A short axis label (e.g. “Jun 23”) for time-series charts. */
    shortDate: (value: string | number | Date) => new Intl.DateTimeFormat(tag, { month: 'short', day: 'numeric' }).format(toDate(value)),
    /** Full date + time (e.g. for "last imported"), locale-aware. */
    dateTime: (value: string | number | Date) => new Intl.DateTimeFormat(tag, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)),
    /** Locale-aware relative time (e.g. “5m ago” / “قبل 5 دقائق”). Picks the
     *  largest sensible unit and lets Intl supply the words + digits. */
    relativeTime: (value: string | number | Date) => {
      const rtf = new Intl.RelativeTimeFormat(tag, { numeric: 'auto', style: 'narrow' });
      const diffMs = new Date(value).getTime() - Date.now();
      const abs = Math.abs(diffMs);
      const min = 60_000;
      const hour = 60 * min;
      const day = 24 * hour;
      const week = 7 * day;
      if (abs < min) return rtf.format(0, 'second');
      if (abs < hour) return rtf.format(Math.round(diffMs / min), 'minute');
      if (abs < day) return rtf.format(Math.round(diffMs / hour), 'hour');
      if (abs < week) return rtf.format(Math.round(diffMs / day), 'day');
      return rtf.format(Math.round(diffMs / week), 'week');
    },
  };
}

/**
 * A counted message's variables: the number in the locale's digits, and its
 * plural category (`one`, `two`, `few`…) picked from the number itself, so
 * "1 page", Arabic "صفحتان" and Russian "5 страниц" each get their own form.
 */
export function countVariables(locale: string, value: number) {
  return { count: new Intl.NumberFormat(localeTag(locale)).format(value), form: new Intl.PluralRules(locale).select(value) };
}

const CALENDAR_DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * Parse a date for display. A bare calendar day ("YYYY-MM-DD", as analytics
 * series buckets arrive, already in the viewer's timezone) is read as that
 * local day: `new Date('2026-08-26')` is UTC midnight, which every formatter
 * west of UTC renders as the previous day. Anything else (a full timestamp) is
 * passed through to the Date constructor.
 */
export function parseCalendarDate(value: string): Date {
  const match = CALENDAR_DAY.exec(value);
  if (!match) return new Date(value);
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
}

const toDate = (value: string | number | Date) => (typeof value === 'string' ? parseCalendarDate(value) : new Date(value));

/** The BCP-47 tag used for UI formatting. Arabic uses Western 0-9 digits. */
export function localeTag(locale: string) {
  return locale.toLowerCase().startsWith('ar') ? `${locale}-u-nu-latn` : locale;
}

/** Whole-unit currency formatting (no trailing “.00”) so a free plan reads “$0”, not “$0.00”. */
export function formatCurrency(tag: string, value: number, currency = 'USD') {
  return new Intl.NumberFormat(tag, { style: 'currency', currency, maximumFractionDigits: Number.isInteger(value) ? 0 : 2 }).format(value);
}
