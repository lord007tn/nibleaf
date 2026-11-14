import { resolveLocale } from './locales';
import { site_copypage } from './paraglide/messages/site_copypage.js';
import { site_copypagehint } from './paraglide/messages/site_copypagehint.js';
import { site_openinaihint } from './paraglide/messages/site_openinaihint.js';
import { site_openinchatgpt } from './paraglide/messages/site_openinchatgpt.js';
import { site_openinclaude } from './paraglide/messages/site_openinclaude.js';
import { site_pageactions } from './paraglide/messages/site_pageactions.js';
import { site_pagecopied } from './paraglide/messages/site_pagecopied.js';
import { site_pagecopyfailed } from './paraglide/messages/site_pagecopyfailed.js';
import { site_viewmarkdownhint } from './paraglide/messages/site_viewmarkdownhint.js';
import { type SiteMessageKey, siteT } from './site';

/*
 * The page actions' own messages (PUB-018): the split button by the page title
 * and its menu. They load with those components only. `siteT` rides in the root
 * chunk (the consent banner uses it), which every route carries, the auth pages
 * included, so keys added there grow every route's bundle.
 */
const pageActionMessages = {
  copyPage: site_copypage,
  copyPageHint: site_copypagehint,
  pageCopied: site_pagecopied,
  pageCopyFailed: site_pagecopyfailed,
  pageActions: site_pageactions,
  viewMarkdownHint: site_viewmarkdownhint,
  openInChatGpt: site_openinchatgpt,
  openInClaude: site_openinclaude,
  openInAiHint: site_openinaihint,
} as const;

export type SitePageActionsMessageKey = keyof typeof pageActionMessages;

const isPageActionKey = (key: string): key is SitePageActionsMessageKey => key in pageActionMessages;

/** Translates the page actions' own keys and, through `siteT`, every other plain reader key. */
export function sitePageActionsT(language?: string): (key: SitePageActionsMessageKey | SiteMessageKey) => string {
  const locale = resolveLocale(language) ?? 'en';
  const site = siteT(language) as (key: string) => string;
  return (key) => (isPageActionKey(key) ? pageActionMessages[key](undefined, { locale }) : site(key));
}
