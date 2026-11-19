import { dashboardMessage } from '@nibleaf/i18n/dashboard-catalog';
import type { Locale } from './locales';
import { MESSAGE_IDS, type MessageKey } from './message-ids';
import type { MessageVariables } from './message-types';
import { getLocale } from './runtime';

/**
 * Translates through the dashboard catalog. In the browser only English and the
 * prepared interface locale are available, so `locale` must be that active
 * locale (`useLocale` passes it). Text needed in any other language, such as a
 * page's language or a fixed-language surface, reads its named Paraglide
 * messages through `./scoped`; the app's locale-boundary test enforces this.
 */
export function translateFn(key: MessageKey, variables?: MessageVariables, locale?: Locale): string {
  const activeLocale = locale ?? (getLocale() as Locale);
  const message = dashboardMessage(MESSAGE_IDS[key], activeLocale);
  return message?.(variables ?? {}, { locale: activeLocale }) ?? key;
}
