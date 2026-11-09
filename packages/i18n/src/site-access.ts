import { resolveLocale } from './locales';
import type { MessageFn, MessageVariables } from './message-types';
import { site_privateaskbody } from './paraglide/messages/site_privateaskbody.js';
import { site_privateasklink } from './paraglide/messages/site_privateasklink.js';
import { site_privateaskname } from './paraglide/messages/site_privateaskname.js';
import { site_privateasknote } from './paraglide/messages/site_privateasknote.js';
import { site_privateasksend } from './paraglide/messages/site_privateasksend.js';
import { site_privateasksent } from './paraglide/messages/site_privateasksent.js';
import { site_privateasktitle } from './paraglide/messages/site_privateasktitle.js';
import { site_privatebacktosignin } from './paraglide/messages/site_privatebacktosignin.js';
import { site_privatecodelabel } from './paraglide/messages/site_privatecodelabel.js';
import { site_privatecodesent } from './paraglide/messages/site_privatecodesent.js';
import { site_privateemaillabel } from './paraglide/messages/site_privateemaillabel.js';
import { site_privatefailed } from './paraglide/messages/site_privatefailed.js';
import { site_privateinvalidcode } from './paraglide/messages/site_privateinvalidcode.js';
import { site_privateinviteaccept } from './paraglide/messages/site_privateinviteaccept.js';
import { site_privateinvitebody } from './paraglide/messages/site_privateinvitebody.js';
import { site_privateinvitetitle } from './paraglide/messages/site_privateinvitetitle.js';
import { site_privateinviteused } from './paraglide/messages/site_privateinviteused.js';
import { site_privateotheremail } from './paraglide/messages/site_privateotheremail.js';
import { site_privatereadersbody } from './paraglide/messages/site_privatereadersbody.js';
import { site_privateresend } from './paraglide/messages/site_privateresend.js';
import { site_privatesendcode } from './paraglide/messages/site_privatesendcode.js';
import { site_privatesignin } from './paraglide/messages/site_privatesignin.js';
import { site_privatesignintitle } from './paraglide/messages/site_privatesignintitle.js';
import { site_privateteambody } from './paraglide/messages/site_privateteambody.js';
import { site_privatetoomany } from './paraglide/messages/site_privatetoomany.js';

/*
 * Messages only the private-site sign-in screen shows. That screen loads on
 * demand, so its strings (in every locale) stay out of every published page's
 * first load; apps/app/vite.config.ts keeps these message files out of the
 * shared `public-site-i18n` chunk. Its title comes from `siteT` for the page head.
 */
const accessMessages = {
  privateSignIn: site_privatesignin,
  privateSignInTitle: site_privatesignintitle,
  privateReadersBody: site_privatereadersbody,
  privateTeamBody: site_privateteambody,
  privateEmailLabel: site_privateemaillabel,
  privateSendCode: site_privatesendcode,
  privateCodeSent: site_privatecodesent,
  privateCodeLabel: site_privatecodelabel,
  privateOtherEmail: site_privateotheremail,
  privateResend: site_privateresend,
  privateInvalidCode: site_privateinvalidcode,
  privateTooMany: site_privatetoomany,
  privateFailed: site_privatefailed,
  privateInviteTitle: site_privateinvitetitle,
  privateInviteBody: site_privateinvitebody,
  privateInviteAccept: site_privateinviteaccept,
  privateInviteUsed: site_privateinviteused,
  privateAskLink: site_privateasklink,
  privateAskTitle: site_privateasktitle,
  privateAskBody: site_privateaskbody,
  privateAskName: site_privateaskname,
  privateAskNote: site_privateasknote,
  privateAskSend: site_privateasksend,
  privateAskSent: site_privateasksent,
  privateBackToSignIn: site_privatebacktosignin,
};

export type SiteAccessMessageKey = keyof typeof accessMessages;

/** Translates the private-site screen's own keys. */
export function siteAccessT(language?: string): (key: SiteAccessMessageKey, variables?: MessageVariables) => string {
  const locale = resolveLocale(language) ?? 'en';
  return (key, variables) => (accessMessages[key] as unknown as MessageFn)(variables, { locale });
}
