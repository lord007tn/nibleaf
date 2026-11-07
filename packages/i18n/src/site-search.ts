import { resolveLocale } from './locales';
import type { MessageFn, MessageVariables } from './message-types';
import { site_closesearch } from './paraglide/messages/site_closesearch.js';
import { site_results } from './paraglide/messages/site_results.js';
import { site_searchaskaiabout } from './paraglide/messages/site_searchaskaiabout.js';
import { site_searchaskaihint } from './paraglide/messages/site_searchaskaihint.js';
import { site_searchclearrecent } from './paraglide/messages/site_searchclearrecent.js';
import { site_searchdescription } from './paraglide/messages/site_searchdescription.js';
import { site_searchfailed } from './paraglide/messages/site_searchfailed.js';
import { site_searchfilterversion } from './paraglide/messages/site_searchfilterversion.js';
import { site_searching } from './paraglide/messages/site_searching.js';
import { site_searchkeysclose } from './paraglide/messages/site_searchkeysclose.js';
import { site_searchkeysnavigate } from './paraglide/messages/site_searchkeysnavigate.js';
import { site_searchkeysopen } from './paraglide/messages/site_searchkeysopen.js';
import { site_searchnoresultsfor } from './paraglide/messages/site_searchnoresultsfor.js';
import { site_searchnoresultshint } from './paraglide/messages/site_searchnoresultshint.js';
import { site_searchpages } from './paraglide/messages/site_searchpages.js';
import { site_searchprompt } from './paraglide/messages/site_searchprompt.js';
import { site_searchrecent } from './paraglide/messages/site_searchrecent.js';
import { site_searchresultcount } from './paraglide/messages/site_searchresultcount.js';
import { site_searchretry } from './paraglide/messages/site_searchretry.js';
import { site_searchsuggested } from './paraglide/messages/site_searchsuggested.js';
import { site_searchversionlabel } from './paraglide/messages/site_searchversionlabel.js';
import { type SiteTranslator, siteT } from './site';

/*
 * Messages only the published reader's search dialog shows. The dialog loads on
 * demand, so its strings (in every locale) stay out of the reader's first load;
 * apps/app/vite.config.ts keeps these message files out of the shared
 * `public-site-i18n` chunk. Everything else comes from `siteT`.
 */

const searchVariableMessages = {
  searchNoResultsFor: site_searchnoresultsfor,
  searchAskAiAbout: site_searchaskaiabout,
  searchResultCount: site_searchresultcount,
};

const searchMessages = {
  closeSearch: site_closesearch,
  results: site_results,
  searchAskAiHint: site_searchaskaihint,
  searchClearRecent: site_searchclearrecent,
  searchDescription: site_searchdescription,
  searchFailed: site_searchfailed,
  searchFilterVersion: site_searchfilterversion,
  searching: site_searching,
  searchKeysClose: site_searchkeysclose,
  searchKeysNavigate: site_searchkeysnavigate,
  searchKeysOpen: site_searchkeysopen,
  searchNoResultsHint: site_searchnoresultshint,
  searchPages: site_searchpages,
  searchPrompt: site_searchprompt,
  searchRecent: site_searchrecent,
  searchRetry: site_searchretry,
  searchSuggested: site_searchsuggested,
  searchVersionLabel: site_searchversionlabel,
} satisfies Record<string, MessageFn>;

type SearchVariableKey = keyof typeof searchVariableMessages;
type SearchPlainKey = keyof typeof searchMessages;
export type SiteSearchMessageKey = SearchVariableKey | SearchPlainKey;
type SearchVariables<Key extends SearchVariableKey> = Parameters<(typeof searchVariableMessages)[Key]>[0];

/** Translates the search dialog's own keys and, through `siteT`, every other reader key. */
export type SiteSearchTranslator = {
  <Key extends SearchVariableKey>(key: Key, variables: SearchVariables<Key>): string;
  (key: SearchPlainKey): string;
} & SiteTranslator;

const isSearchVariableKey = (key: string): key is SearchVariableKey => key in searchVariableMessages;
const isSearchPlainKey = (key: string): key is SearchPlainKey => key in searchMessages;

export function siteSearchT(language?: string): SiteSearchTranslator {
  const locale = resolveLocale(language) ?? 'en';
  const site = siteT(language) as (key: string, variables?: MessageVariables) => string;
  // The overloads check keys and variables at each call site; this only dispatches.
  const translate = (key: string, variables?: MessageVariables): string => {
    if (isSearchVariableKey(key)) return (searchVariableMessages[key] as unknown as MessageFn)(variables, { locale });
    if (isSearchPlainKey(key)) return searchMessages[key](undefined, { locale });
    return site(key, variables);
  };
  return translate as SiteSearchTranslator;
}
