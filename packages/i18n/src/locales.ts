export const INTERFACE_LOCALES = [
  { code: 'en', label: 'English', native: 'English', direction: 'ltr' },
  { code: 'ar', label: 'Arabic', native: 'العربية', direction: 'rtl' },
  { code: 'zh-CN', label: 'Chinese (Simplified)', native: '简体中文', direction: 'ltr' },
  { code: 'hi', label: 'Hindi', native: 'हिन्दी', direction: 'ltr' },
  { code: 'es', label: 'Spanish', native: 'Español', direction: 'ltr' },
  { code: 'fr', label: 'French', native: 'Français', direction: 'ltr' },
  { code: 'bn', label: 'Bengali', native: 'বাংলা', direction: 'ltr' },
  { code: 'pt-BR', label: 'Portuguese (Brazil)', native: 'Português (Brasil)', direction: 'ltr' },
  { code: 'ru', label: 'Russian', native: 'Русский', direction: 'ltr' },
  { code: 'ur', label: 'Urdu', native: 'اردو', direction: 'rtl' },
  { code: 'id', label: 'Indonesian', native: 'Bahasa Indonesia', direction: 'ltr' },
  { code: 'de', label: 'German', native: 'Deutsch', direction: 'ltr' },
] as const;

export type Locale = (typeof INTERFACE_LOCALES)[number]['code'];
export type InterfaceLocale = (typeof INTERFACE_LOCALES)[number];
export type Direction = InterfaceLocale['direction'];

export const DEFAULT_LOCALE = 'en' as const satisfies Locale;
export const RTL_LOCALES = new Set<Locale>(['ar', 'ur']);

const localeByCode = new Map<string, InterfaceLocale>(INTERFACE_LOCALES.map((locale) => [locale.code.toLowerCase(), locale]));
const preferredByBase = new Map<string, Locale>([
  ['ar', 'ar'],
  ['bn', 'bn'],
  ['de', 'de'],
  ['en', 'en'],
  ['es', 'es'],
  ['fr', 'fr'],
  ['hi', 'hi'],
  ['id', 'id'],
  ['pt', 'pt-BR'],
  ['ru', 'ru'],
  ['ur', 'ur'],
  ['zh', 'zh-CN'],
]);

export const resolveLocale = (value?: string | null): Locale | null => {
  const normalized = value?.trim().replaceAll('_', '-').toLowerCase();
  if (!normalized) return null;
  const exact = localeByCode.get(normalized);
  if (exact) return exact.code;
  return preferredByBase.get(normalized.split('-')[0] ?? '') ?? null;
};

export const isRtl = (locale: Locale): boolean => RTL_LOCALES.has(locale);
export const isSupportedLocale = (value: string): value is Locale => resolveLocale(value) === value;
