import { getLocale } from '@nibleaf/i18n';
import { useLocale } from '@nibleaf/i18n/react';

const localeTag = (locale: string) => (locale.toLowerCase().startsWith('ar') ? `${locale}-u-nu-latn` : locale);

export const fmtDateTime = (iso: string) =>
  new Intl.DateTimeFormat(localeTag(getLocale()), { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(iso));
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
  return new Intl.RelativeTimeFormat(localeTag(getLocale()), { numeric: 'auto' }).format(Math.round(delta / milliseconds), unit);
};
export const fmtBytes = (bytes: number) =>
  new Intl.NumberFormat(localeTag(getLocale()), {
    style: 'unit',
    unit: 'byte',
    unitDisplay: 'narrow',
    notation: 'compact',
    maximumFractionDigits: 1,
  }).format(bytes);

/** Locale-aware formatters bound to the active Paraglide locale. */
export function useFormatters() {
  const { locale } = useLocale();
  const tag = localeTag(locale);
  return {
    date: (iso: string) => new Intl.DateTimeFormat(tag, { dateStyle: 'medium' }).format(new Date(iso)),
    dateTime: (iso: string) => new Intl.DateTimeFormat(tag, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(iso)),
    relative: (iso: string) => {
      const delta = new Date(iso).getTime() - Date.now();
      const absolute = Math.abs(delta);
      const units: [Intl.RelativeTimeFormatUnit, number][] = [
        ['day', 24 * 60 * 60 * 1000],
        ['hour', 60 * 60 * 1000],
        ['minute', 60 * 1000],
      ];
      const [unit, milliseconds] = units.find(([, size]) => absolute >= size) ?? ['minute', 60 * 1000];
      return new Intl.RelativeTimeFormat(tag, { numeric: 'auto' }).format(Math.round(delta / milliseconds), unit);
    },
    bytes: (bytes: number) =>
      new Intl.NumberFormat(tag, { style: 'unit', unit: 'byte', unitDisplay: 'narrow', notation: 'compact', maximumFractionDigits: 1 }).format(bytes),
    number: (value: number) => new Intl.NumberFormat(tag).format(value),
    percent: (value: number) => new Intl.NumberFormat(tag, { style: 'percent', maximumFractionDigits: 0 }).format(value / 100),
    shortDate: (iso: string) => new Intl.DateTimeFormat(tag, { month: 'short', day: 'numeric' }).format(new Date(iso)),
  };
}
