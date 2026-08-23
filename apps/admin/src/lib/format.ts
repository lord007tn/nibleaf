import { getLocale } from '@nibleaf/i18n';
import { useLocale } from '@nibleaf/i18n/react';

export const fmtDateTime = (iso: string) => new Intl.DateTimeFormat(getLocale(), { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(iso));
export const fmtRelative = (iso: string) => {
  const delta = new Date(iso).getTime() - Date.now();
  const absolute = Math.abs(delta);
  const [unit, milliseconds] =
    (
      [
        ['day', 86_400_000],
        ['hour', 3_600_000],
        ['minute', 60_000],
      ] as const
    ).find(([, size]) => absolute >= size) ?? (['minute', 60_000] as const);
  return new Intl.RelativeTimeFormat(getLocale(), { numeric: 'auto' }).format(Math.round(delta / milliseconds), unit);
};
export const fmtBytes = (bytes: number) =>
  new Intl.NumberFormat(getLocale(), { style: 'unit', unit: 'byte', unitDisplay: 'narrow', notation: 'compact', maximumFractionDigits: 1 }).format(
    bytes,
  );

/** Locale-aware formatters bound to the active Paraglide locale. */
export function useFormatters() {
  const { locale } = useLocale();
  return {
    date: (iso: string) => new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(new Date(iso)),
    dateTime: (iso: string) => new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(iso)),
    relative: (iso: string) => {
      const delta = new Date(iso).getTime() - Date.now();
      const absolute = Math.abs(delta);
      const units: [Intl.RelativeTimeFormatUnit, number][] = [
        ['day', 24 * 60 * 60 * 1000],
        ['hour', 60 * 60 * 1000],
        ['minute', 60 * 1000],
      ];
      const [unit, milliseconds] = units.find(([, size]) => absolute >= size) ?? ['minute', 60 * 1000];
      return new Intl.RelativeTimeFormat(locale, { numeric: 'auto' }).format(Math.round(delta / milliseconds), unit);
    },
    bytes: (bytes: number) =>
      new Intl.NumberFormat(locale, { style: 'unit', unit: 'byte', unitDisplay: 'narrow', notation: 'compact', maximumFractionDigits: 1 }).format(
        bytes,
      ),
    number: (value: number) => new Intl.NumberFormat(locale).format(value),
    percent: (value: number) => new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 0 }).format(value / 100),
    shortDate: (iso: string) => new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric' }).format(new Date(iso)),
  };
}
