/**
 * Curated catalog of selectable site languages for the "Add language" flow.
 *
 * `code` is a BCP-47 tag, `label` is the English display name, `native` is the
 * endonym (the language's own name, in its own script), and `rtl` marks
 * right-to-left scripts. The server stores `direction` as 'LTR' | 'RTL'; use
 * {@link directionFor} to map a catalog code to that shape.
 */
export interface CatalogLanguage {
  code: string;
  label: string;
  native: string;
  rtl: boolean;
}

export const LANGUAGE_CATALOG: CatalogLanguage[] = [
  { code: 'en', label: 'English', native: 'English', rtl: false },
  { code: 'ar', label: 'Arabic', native: 'العربية', rtl: true },
  { code: 'he', label: 'Hebrew', native: 'עברית', rtl: true },
  { code: 'fa', label: 'Persian', native: 'فارسی', rtl: true },
  { code: 'ur', label: 'Urdu', native: 'اردو', rtl: true },
  { code: 'es', label: 'Spanish', native: 'Español', rtl: false },
  { code: 'pt', label: 'Portuguese', native: 'Português', rtl: false },
  { code: 'pt-BR', label: 'Portuguese (Brazil)', native: 'Português (Brasil)', rtl: false },
  { code: 'fr', label: 'French', native: 'Français', rtl: false },
  { code: 'de', label: 'German', native: 'Deutsch', rtl: false },
  { code: 'it', label: 'Italian', native: 'Italiano', rtl: false },
  { code: 'nl', label: 'Dutch', native: 'Nederlands', rtl: false },
  { code: 'ru', label: 'Russian', native: 'Русский', rtl: false },
  { code: 'uk', label: 'Ukrainian', native: 'Українська', rtl: false },
  { code: 'pl', label: 'Polish', native: 'Polski', rtl: false },
  { code: 'tr', label: 'Turkish', native: 'Türkçe', rtl: false },
  { code: 'zh', label: 'Chinese (Simplified)', native: '简体中文', rtl: false },
  { code: 'zh-TW', label: 'Chinese (Traditional)', native: '繁體中文', rtl: false },
  { code: 'ja', label: 'Japanese', native: '日本語', rtl: false },
  { code: 'ko', label: 'Korean', native: '한국어', rtl: false },
  { code: 'hi', label: 'Hindi', native: 'हिन्दी', rtl: false },
  { code: 'bn', label: 'Bengali', native: 'বাংলা', rtl: false },
  { code: 'ta', label: 'Tamil', native: 'தமிழ்', rtl: false },
  { code: 'te', label: 'Telugu', native: 'తెలుగు', rtl: false },
  { code: 'id', label: 'Indonesian', native: 'Bahasa Indonesia', rtl: false },
  { code: 'ms', label: 'Malay', native: 'Bahasa Melayu', rtl: false },
  { code: 'th', label: 'Thai', native: 'ไทย', rtl: false },
  { code: 'vi', label: 'Vietnamese', native: 'Tiếng Việt', rtl: false },
  { code: 'sv', label: 'Swedish', native: 'Svenska', rtl: false },
  { code: 'da', label: 'Danish', native: 'Dansk', rtl: false },
  { code: 'no', label: 'Norwegian', native: 'Norsk', rtl: false },
  { code: 'fi', label: 'Finnish', native: 'Suomi', rtl: false },
  { code: 'cs', label: 'Czech', native: 'Čeština', rtl: false },
  { code: 'el', label: 'Greek', native: 'Ελληνικά', rtl: false },
  { code: 'ro', label: 'Romanian', native: 'Română', rtl: false },
  { code: 'hu', label: 'Hungarian', native: 'Magyar', rtl: false },
];

/** Maps a catalog language code to the server's text-direction shape. */
export function directionFor(code: string): 'LTR' | 'RTL' {
  return LANGUAGE_CATALOG.find((lang) => lang.code === code)?.rtl ? 'RTL' : 'LTR';
}
