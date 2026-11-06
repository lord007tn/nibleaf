import { resolveLocale } from './locales';
import type { MessageFn, MessageVariables } from './message-types';
import { site_closeimage } from './paraglide/messages/site_closeimage.js';
import { site_copied } from './paraglide/messages/site_copied.js';
import { site_copycode } from './paraglide/messages/site_copycode.js';
import { site_copyfailed } from './paraglide/messages/site_copyfailed.js';
import { site_copysectionlink } from './paraglide/messages/site_copysectionlink.js';
import { site_defaultvalue } from './paraglide/messages/site_defaultvalue.js';
import { site_deprecated } from './paraglide/messages/site_deprecated.js';
import { site_details } from './paraglide/messages/site_details.js';
import { site_required } from './paraglide/messages/site_required.js';
import { site_showproperties } from './paraglide/messages/site_showproperties.js';
import { site_tab } from './paraglide/messages/site_tab.js';
import { site_viewfullsize } from './paraglide/messages/site_viewfullsize.js';
import { site_viewfullsizeof } from './paraglide/messages/site_viewfullsizeof.js';
import { type SiteTranslator, siteT } from './site';

/*
 * Messages only the published reader's article renderer shows (code copy, image
 * zoom, tabs, API fields). The renderer loads as its own chunk, so its strings stay
 * out of the reader's first load; apps/app/vite.config.ts keeps these message files
 * out of the shared `public-site-i18n` chunk. Everything else comes from `siteT`.
 */

const contentVariableMessages = {
  viewFullSizeOf: site_viewfullsizeof,
};

const contentMessages = {
  closeImage: site_closeimage,
  copied: site_copied,
  copyCode: site_copycode,
  copyFailed: site_copyfailed,
  copySectionLink: site_copysectionlink,
  defaultValue: site_defaultvalue,
  deprecated: site_deprecated,
  details: site_details,
  required: site_required,
  showProperties: site_showproperties,
  tab: site_tab,
  viewFullSize: site_viewfullsize,
} satisfies Record<string, MessageFn>;

type ContentVariableKey = keyof typeof contentVariableMessages;
type ContentPlainKey = keyof typeof contentMessages;
export type SiteContentMessageKey = ContentVariableKey | ContentPlainKey;
type ContentVariables<Key extends ContentVariableKey> = Parameters<(typeof contentVariableMessages)[Key]>[0];

/** Translates the article renderer's own keys and, through `siteT`, every other reader key. */
export type SiteContentTranslator = {
  <Key extends ContentVariableKey>(key: Key, variables: ContentVariables<Key>): string;
  (key: ContentPlainKey): string;
} & SiteTranslator;

const isContentVariableKey = (key: string): key is ContentVariableKey => key in contentVariableMessages;
const isContentPlainKey = (key: string): key is ContentPlainKey => key in contentMessages;

export function siteContentT(language?: string): SiteContentTranslator {
  const locale = resolveLocale(language) ?? 'en';
  const site = siteT(language) as (key: string, variables?: MessageVariables) => string;
  // The overloads check keys and variables at each call site; this only dispatches.
  const translate = (key: string, variables?: MessageVariables): string => {
    if (isContentVariableKey(key)) return (contentVariableMessages[key] as unknown as MessageFn)(variables, { locale });
    if (isContentPlainKey(key)) return contentMessages[key](undefined, { locale });
    return site(key, variables);
  };
  return translate as SiteContentTranslator;
}
