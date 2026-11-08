import { resolveLocale } from './locales';
import type { MessageKey } from './message-ids';
import type { MessageFn, MessageVariables } from './message-types';
import { site_analyticsconsentaccept } from './paraglide/messages/site_analyticsconsentaccept.js';
import { site_analyticsconsentbody } from './paraglide/messages/site_analyticsconsentbody.js';
import { site_analyticsconsentdecline } from './paraglide/messages/site_analyticsconsentdecline.js';
import { site_analyticsconsentmanage } from './paraglide/messages/site_analyticsconsentmanage.js';
import { site_analyticsconsentprivacy } from './paraglide/messages/site_analyticsconsentprivacy.js';
import { site_analyticsconsenttitle } from './paraglide/messages/site_analyticsconsenttitle.js';
import { site_articledetails } from './paraglide/messages/site_articledetails.js';
import { site_blog } from './paraglide/messages/site_blog.js';
import { site_breadcrumb } from './paraglide/messages/site_breadcrumb.js';
import { site_changelanguage } from './paraglide/messages/site_changelanguage.js';
import { site_changelog } from './paraglide/messages/site_changelog.js';
import { site_changelogempty } from './paraglide/messages/site_changelogempty.js';
import { site_changelogpagecount } from './paraglide/messages/site_changelogpagecount.js';
import { site_changelogrelease } from './paraglide/messages/site_changelogrelease.js';
import { site_changelogsubtitle } from './paraglide/messages/site_changelogsubtitle.js';
import { site_changeversion } from './paraglide/messages/site_changeversion.js';
import { site_copymarkdown } from './paraglide/messages/site_copymarkdown.js';
import { site_darkmode } from './paraglide/messages/site_darkmode.js';
import { site_defaultversion } from './paraglide/messages/site_defaultversion.js';
import { site_dismissbanner } from './paraglide/messages/site_dismissbanner.js';
import { site_docs } from './paraglide/messages/site_docs.js';
import { site_docspages } from './paraglide/messages/site_docspages.js';
import { site_docssections } from './paraglide/messages/site_docssections.js';
import { site_documentation } from './paraglide/messages/site_documentation.js';
import { site_editpage } from './paraglide/messages/site_editpage.js';
import { site_feedbackno } from './paraglide/messages/site_feedbackno.js';
import { site_feedbackquestion } from './paraglide/messages/site_feedbackquestion.js';
import { site_feedbackthanks } from './paraglide/messages/site_feedbackthanks.js';
import { site_feedbackyes } from './paraglide/messages/site_feedbackyes.js';
import { site_home } from './paraglide/messages/site_home.js';
import { site_importadditionalpages } from './paraglide/messages/site_importadditionalpages.js';
import { site_importblog } from './paraglide/messages/site_importblog.js';
import { site_importpages } from './paraglide/messages/site_importpages.js';
import { site_language } from './paraglide/messages/site_language.js';
import { site_languagecurrent } from './paraglide/messages/site_languagecurrent.js';
import { site_loading } from './paraglide/messages/site_loading.js';
import { site_loadingapireference } from './paraglide/messages/site_loadingapireference.js';
import { site_logo } from './paraglide/messages/site_logo.js';
import { site_madewith } from './paraglide/messages/site_madewith.js';
import { site_markdowncopyfailed } from './paraglide/messages/site_markdowncopyfailed.js';
import { site_menu } from './paraglide/messages/site_menu.js';
import { site_minreadcount } from './paraglide/messages/site_minreadcount.js';
import { site_next } from './paraglide/messages/site_next.js';
import { site_noanswergrounded } from './paraglide/messages/site_noanswergrounded.js';
import { site_notfoundbody } from './paraglide/messages/site_notfoundbody.js';
import { site_notfoundhome } from './paraglide/messages/site_notfoundhome.js';
import { site_notfoundsearch } from './paraglide/messages/site_notfoundsearch.js';
import { site_notfoundtitle } from './paraglide/messages/site_notfoundtitle.js';
import { site_notpublishedbody } from './paraglide/messages/site_notpublishedbody.js';
import { site_notpublishedtitle } from './paraglide/messages/site_notpublishedtitle.js';
import { site_onthispage } from './paraglide/messages/site_onthispage.js';
import { site_openmenu } from './paraglide/messages/site_openmenu.js';
import { site_pageunavailable } from './paraglide/messages/site_pageunavailable.js';
import { site_previous } from './paraglide/messages/site_previous.js';
import { site_privatetitle } from './paraglide/messages/site_privatetitle.js';
import { site_raiseissue } from './paraglide/messages/site_raiseissue.js';
import { site_reportabuse } from './paraglide/messages/site_reportabuse.js';
import { site_screenshotcount } from './paraglide/messages/site_screenshotcount.js';
import { site_search } from './paraglide/messages/site_search.js';
import { site_searchcancel } from './paraglide/messages/site_searchcancel.js';
import { site_searchdocumentation } from './paraglide/messages/site_searchdocumentation.js';
import { site_searchempty } from './paraglide/messages/site_searchempty.js';
import { site_searchfilterlanguage } from './paraglide/messages/site_searchfilterlanguage.js';
import { site_searchmode } from './paraglide/messages/site_searchmode.js';
import { site_searchplaceholder } from './paraglide/messages/site_searchplaceholder.js';
import { site_signout } from './paraglide/messages/site_signout.js';
import { site_signoutfailed } from './paraglide/messages/site_signoutfailed.js';
import { site_sitelinks } from './paraglide/messages/site_sitelinks.js';
import { site_skiptocontent } from './paraglide/messages/site_skiptocontent.js';
import { site_sources } from './paraglide/messages/site_sources.js';
import { site_tags } from './paraglide/messages/site_tags.js';
import { site_togglesubpages } from './paraglide/messages/site_togglesubpages.js';
import { site_updated } from './paraglide/messages/site_updated.js';
import { site_version } from './paraglide/messages/site_version.js';
import { site_versioncurrent } from './paraglide/messages/site_versioncurrent.js';
import { site_viewdetails } from './paraglide/messages/site_viewdetails.js';
import { site_viewmarkdown } from './paraglide/messages/site_viewmarkdown.js';
import type { SiteAccessMessageKey } from './site-access';
import type { SiteChatMessageKey } from './site-chat';
import type { SiteContentMessageKey } from './site-content';
import type { SiteSearchMessageKey } from './site-search';

/** Messages with {variables} keep Paraglide's generated input types, so a caller
 * that forgets a variable fails to compile instead of rendering "{query}". */
const siteVariableMessages = {
  languageCurrent: site_languagecurrent,
  versionCurrent: site_versioncurrent,
};

/** Counted messages: each locale's variants are keyed by the CLDR plural
 * category (Arabic has zero/one/two/few/many/other), chosen here with
 * Intl.PluralRules so callers pass only the number. */
const sitePluralMessages = {
  minReadCount: site_minreadcount,
  screenshotCount: site_screenshotcount,
  changelogPageCount: site_changelogpagecount,
};

const siteMessages = {
  searchCancel: site_searchcancel,
  docs: site_docs,
  changelog: site_changelog,
  search: site_search,
  searchDocumentation: site_searchdocumentation,
  searchFilterLanguage: site_searchfilterlanguage,
  searchPlaceholder: site_searchplaceholder,
  searchEmpty: site_searchempty,
  loading: site_loading,
  previous: site_previous,
  next: site_next,
  onThisPage: site_onthispage,
  updated: site_updated,
  notPublishedTitle: site_notpublishedtitle,
  notPublishedBody: site_notpublishedbody,
  privateTitle: site_privatetitle,
  signOut: site_signout,
  signOutFailed: site_signoutfailed,
  pageUnavailable: site_pageunavailable,
  changelogSubtitle: site_changelogsubtitle,
  changelogEmpty: site_changelogempty,
  changelogRelease: site_changelogrelease,
  feedbackQuestion: site_feedbackquestion,
  feedbackYes: site_feedbackyes,
  feedbackNo: site_feedbackno,
  feedbackThanks: site_feedbackthanks,
  editPage: site_editpage,
  raiseIssue: site_raiseissue,
  analyticsConsentBody: site_analyticsconsentbody,
  analyticsConsentAccept: site_analyticsconsentaccept,
  analyticsConsentDecline: site_analyticsconsentdecline,
  analyticsConsentTitle: site_analyticsconsenttitle,
  analyticsConsentManage: site_analyticsconsentmanage,
  analyticsConsentPrivacy: site_analyticsconsentprivacy,
  searchMode: site_searchmode,
  sources: site_sources,
  home: site_home,
  blog: site_blog,
  madeWith: site_madewith,
  reportAbuse: site_reportabuse,
  noAnswerGrounded: site_noanswergrounded,
  importBlog: site_importblog,
  importPages: site_importpages,
  importAdditionalPages: site_importadditionalpages,
  changeLanguage: site_changelanguage,
  darkMode: site_darkmode,
  breadcrumb: site_breadcrumb,
  toggleSubpages: site_togglesubpages,
  articleDetails: site_articledetails,
  viewMarkdown: site_viewmarkdown,
  copyMarkdown: site_copymarkdown,
  markdownCopyFailed: site_markdowncopyfailed,
  viewDetails: site_viewdetails,
  dismissBanner: site_dismissbanner,
  changeVersion: site_changeversion,
  skipToContent: site_skiptocontent,
  openMenu: site_openmenu,
  menu: site_menu,
  language: site_language,
  version: site_version,
  siteLinks: site_sitelinks,
  docsSections: site_docssections,
  docsPages: site_docspages,
  notFoundTitle: site_notfoundtitle,
  notFoundBody: site_notfoundbody,
  notFoundHome: site_notfoundhome,
  notFoundSearch: site_notfoundsearch,
  loadingApiReference: site_loadingapireference,
  logo: site_logo,
  documentation: site_documentation,
  defaultVersion: site_defaultversion,
  tags: site_tags,
} satisfies Record<string, MessageFn>;

type SiteContractKey = Extract<MessageKey, `site.${string}`>;
/** The Arabic marketing pages' head copy. Those routes load it lazily
 * (apps/app/src/lib/arabic-marketing-copy.ts) so it stays out of every reader's first load. */
type SiteMarketingHeadKey = `arabic${'Landing' | 'Platforms'}${string}`;
/** Reader keys `siteT` covers: all but those of the lazily loaded search dialog
 * (./site-search), article renderer (./site-content), AI chat panel (./site-chat)
 * and private-site screen (./site-access). */
export type SiteMessageKey = Exclude<
  SiteContractKey extends `site.${infer Key}` ? Key : never,
  SiteSearchMessageKey | SiteContentMessageKey | SiteChatMessageKey | SiteAccessMessageKey | SiteMarketingHeadKey
>;
type SiteVariableKey = keyof typeof siteVariableMessages;
type SitePluralKey = keyof typeof sitePluralMessages;
type SitePlainKey = Exclude<SiteMessageKey, SiteVariableKey | SitePluralKey>;
type SiteVariables<Key extends SiteVariableKey> = Parameters<(typeof siteVariableMessages)[Key]>[0];

/** Translates a reader key; keys whose message has {variables} require them,
 * and counted keys take the number they count. */
export interface SiteTranslator {
  <Key extends SiteVariableKey>(key: Key, variables: SiteVariables<Key>): string;
  (key: SitePluralKey, variables: { count: number }): string;
  (key: SitePlainKey): string;
}

const isVariableKey = (key: SiteMessageKey): key is SiteVariableKey => key in siteVariableMessages;
const isPluralKey = (key: SiteMessageKey): key is SitePluralKey => key in sitePluralMessages;

/** Published-site chrome uses its content locale explicitly; it must not mutate
 * the dashboard's Paraglide locale or depend on a browser preference. */
export function siteT(language?: string): SiteTranslator {
  const locale = resolveLocale(language) ?? 'en';
  // The SiteTranslator overloads check variables at each call site; this
  // dispatch only forwards them.
  const translate = (key: SiteMessageKey, variables?: MessageVariables): string => {
    if (isPluralKey(key)) {
      const count = Number(variables?.count ?? 0);
      const form = new Intl.PluralRules(locale).select(count);
      return (sitePluralMessages[key] as unknown as MessageFn)({ count, form }, { locale });
    }
    return isVariableKey(key) ? (siteVariableMessages[key] as unknown as MessageFn)(variables, { locale }) : siteMessages[key](undefined, { locale });
  };
  return translate as SiteTranslator;
}
