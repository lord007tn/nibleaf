import { dashboardMessage } from '@nibleaf/i18n/dashboard-catalog';
import type { Locale } from './locales';
import { MESSAGE_IDS, type MessageKey } from './message-ids';
import type { MessageVariables } from './message-types';
import { getLocale } from './runtime';

export function translateFn(key: MessageKey, variables?: MessageVariables, locale?: Locale): string {
  const activeLocale = locale ?? (getLocale() as Locale);
  const message = dashboardMessage(MESSAGE_IDS[key], activeLocale);
  return message?.(variables ?? {}, { locale: activeLocale }) ?? key;
}
