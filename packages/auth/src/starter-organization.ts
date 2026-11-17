import { DEFAULT_LOCALE, resolveLocale } from '@nibleaf/i18n/locales';
import { welcome_create_defaultname } from '@nibleaf/i18n/messages/welcome_create_defaultname';
import { welcome_create_defaultnameanonymous } from '@nibleaf/i18n/messages/welcome_create_defaultnameanonymous';

/** New organizations use the same suggested name as the welcome form. */
export function starterOrganizationName(name?: string | null, locale?: string): string {
  const firstName = name?.trim().split(/\s+/)[0];
  const options = { locale: resolveLocale(locale) ?? DEFAULT_LOCALE };
  return firstName ? welcome_create_defaultname({ name: firstName }, options) : welcome_create_defaultnameanonymous(undefined, options);
}
