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
  };
}
