import { resolveLocale } from './locales';
import { site_privatebody } from './paraglide/messages/site_privatebody.js';
import { site_privatemembers } from './paraglide/messages/site_privatemembers.js';
import { site_privatesignin } from './paraglide/messages/site_privatesignin.js';

/*
 * Messages only the private-site screen shows. That screen loads on demand, so
 * its strings (in every locale) stay out of every published page's first load;
 * apps/app/vite.config.ts keeps these message files out of the shared
 * `public-site-i18n` chunk. Its title comes from `siteT` for the page head.
 */
const accessMessages = {
  privateBody: site_privatebody,
  privateMembers: site_privatemembers,
  privateSignIn: site_privatesignin,
};

export type SiteAccessMessageKey = keyof typeof accessMessages;

/** Translates the private-site screen's own keys. */
export function siteAccessT(language?: string): (key: SiteAccessMessageKey) => string {
  const locale = resolveLocale(language) ?? 'en';
  return (key) => accessMessages[key](undefined, { locale });
}
