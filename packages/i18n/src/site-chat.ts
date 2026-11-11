import { resolveLocale } from './locales';
import type { MessageFn, MessageVariables } from './message-types';
import { site_ai_about } from './paraglide/messages/site_ai_about.js';
import { site_ai_caution } from './paraglide/messages/site_ai_caution.js';
import { site_ai_checking } from './paraglide/messages/site_ai_checking.js';
import { site_ai_close } from './paraglide/messages/site_ai_close.js';
import { site_ai_comment } from './paraglide/messages/site_ai_comment.js';
import { site_ai_copied } from './paraglide/messages/site_ai_copied.js';
import { site_ai_copy } from './paraglide/messages/site_ai_copy.js';
import { site_ai_copyfailed } from './paraglide/messages/site_ai_copyfailed.js';
import { site_ai_down } from './paraglide/messages/site_ai_down.js';
import { site_ai_failed } from './paraglide/messages/site_ai_failed.js';
import { site_ai_find } from './paraglide/messages/site_ai_find.js';
import { site_ai_follow_ups } from './paraglide/messages/site_ai_follow_ups.js';
import { site_ai_hard } from './paraglide/messages/site_ai_hard.js';
import { site_ai_incomplete } from './paraglide/messages/site_ai_incomplete.js';
import { site_ai_incorrect } from './paraglide/messages/site_ai_incorrect.js';
import { site_ai_intro } from './paraglide/messages/site_ai_intro.js';
import { site_ai_invalid } from './paraglide/messages/site_ai_invalid.js';
import { site_ai_limit } from './paraglide/messages/site_ai_limit.js';
import { site_ai_new } from './paraglide/messages/site_ai_new.js';
import { site_ai_noanswer } from './paraglide/messages/site_ai_noanswer.js';
import { site_ai_notrelevant } from './paraglide/messages/site_ai_notrelevant.js';
import { site_ai_offline } from './paraglide/messages/site_ai_offline.js';
import { site_ai_other } from './paraglide/messages/site_ai_other.js';
import { site_ai_outdated } from './paraglide/messages/site_ai_outdated.js';
import { site_ai_page } from './paraglide/messages/site_ai_page.js';
import { site_ai_page_body } from './paraglide/messages/site_ai_page_body.js';
import { site_ai_page_title } from './paraglide/messages/site_ai_page_title.js';
import { site_ai_question } from './paraglide/messages/site_ai_question.js';
import { site_ai_quota } from './paraglide/messages/site_ai_quota.js';
import { site_ai_rate } from './paraglide/messages/site_ai_rate.js';
import { site_ai_ready } from './paraglide/messages/site_ai_ready.js';
import { site_ai_remove } from './paraglide/messages/site_ai_remove.js';
import { site_ai_rephrase } from './paraglide/messages/site_ai_rephrase.js';
import { site_ai_retry } from './paraglide/messages/site_ai_retry.js';
import { site_ai_saved } from './paraglide/messages/site_ai_saved.js';
import { site_ai_saving_rating } from './paraglide/messages/site_ai_saving_rating.js';
import { site_ai_searching } from './paraglide/messages/site_ai_searching.js';
import { site_ai_send } from './paraglide/messages/site_ai_send.js';
import { site_ai_source } from './paraglide/messages/site_ai_source.js';
import { site_ai_sources } from './paraglide/messages/site_ai_sources.js';
import { site_ai_start } from './paraglide/messages/site_ai_start.js';
import { site_ai_steps } from './paraglide/messages/site_ai_steps.js';
import { site_ai_stop } from './paraglide/messages/site_ai_stop.js';
import { site_ai_stopped } from './paraglide/messages/site_ai_stopped.js';
import { site_ai_subtitle } from './paraglide/messages/site_ai_subtitle.js';
import { site_ai_suggestions } from './paraglide/messages/site_ai_suggestions.js';
import { site_ai_suggestions_added } from './paraglide/messages/site_ai_suggestions_added.js';
import { site_ai_summary } from './paraglide/messages/site_ai_summary.js';
import { site_ai_support } from './paraglide/messages/site_ai_support.js';
import { site_ai_thanks } from './paraglide/messages/site_ai_thanks.js';
import { site_ai_title } from './paraglide/messages/site_ai_title.js';
import { site_ai_typing } from './paraglide/messages/site_ai_typing.js';
import { site_ai_unavailable } from './paraglide/messages/site_ai_unavailable.js';
import { site_ai_up } from './paraglide/messages/site_ai_up.js';
import { site_ai_writing } from './paraglide/messages/site_ai_writing.js';
import { type SiteTranslator, siteT } from './site';

/*
 * Messages only the published reader's AI chat panel shows. The panel loads on
 * demand, so its strings (in every locale) stay out of the reader's first load;
 * apps/app/vite.config.ts keeps these message files out of the shared
 * `public-site-i18n` chunk. The launcher and the "Ask AI about this page" card
 * load on demand too, so their strings live here.
 */
const chatMessages = {
  aiTitle: site_ai_title,
  aiPage: site_ai_page,
  aiPageBody: site_ai_page_body,
  aiPageTitle: site_ai_page_title,
  aiSubtitle: site_ai_subtitle,
  aiNew: site_ai_new,
  aiClose: site_ai_close,
  aiIntro: site_ai_intro,
  aiStart: site_ai_start,
  aiFind: site_ai_find,
  aiSummary: site_ai_summary,
  aiSteps: site_ai_steps,
  aiAbout: site_ai_about,
  aiRemove: site_ai_remove,
  aiTyping: site_ai_typing,
  aiFollowUps: site_ai_follow_ups,
  aiSupport: site_ai_support,
  aiQuestion: site_ai_question,
  aiSend: site_ai_send,
  aiSavingRating: site_ai_saving_rating,
  aiStop: site_ai_stop,
  aiStopped: site_ai_stopped,
  aiSuggestionsAdded: site_ai_suggestions_added,
  aiCaution: site_ai_caution,
  aiSearching: site_ai_searching,
  aiWriting: site_ai_writing,
  aiChecking: site_ai_checking,
  aiReady: site_ai_ready,
  aiNoAnswer: site_ai_noanswer,
  aiSuggestions: site_ai_suggestions,
  aiRephrase: site_ai_rephrase,
  aiSource: site_ai_source,
  aiSources: site_ai_sources,
  aiCopy: site_ai_copy,
  aiCopied: site_ai_copied,
  aiCopyFailed: site_ai_copyfailed,
  aiUp: site_ai_up,
  aiDown: site_ai_down,
  aiComment: site_ai_comment,
  aiThanks: site_ai_thanks,
  aiRetry: site_ai_retry,
  aiQuota: site_ai_quota,
  aiRate: site_ai_rate,
  aiLimit: site_ai_limit,
  aiUnavailable: site_ai_unavailable,
  aiInvalid: site_ai_invalid,
  aiFailed: site_ai_failed,
  aiOffline: site_ai_offline,
  aiIncorrect: site_ai_incorrect,
  aiIncomplete: site_ai_incomplete,
  aiNotRelevant: site_ai_notrelevant,
  aiHard: site_ai_hard,
  aiOutdated: site_ai_outdated,
  aiOther: site_ai_other,
} satisfies Record<string, MessageFn>;

/** Counted chat messages, with each locale's CLDR plural forms (see siteT). */
const chatPluralMessages = {
  /** Shown only when the server stores question text; `count` is its retention in days. */
  aiSaved: site_ai_saved,
};

export type SiteChatMessageKey = keyof typeof chatMessages;
export type SiteChatPluralKey = keyof typeof chatPluralMessages;

/** Translates the chat panel's own keys and, through `siteT`, every other reader key. */
export type SiteChatTranslator = ((key: SiteChatMessageKey) => string) &
  ((key: SiteChatPluralKey, variables: { count: number }) => string) &
  SiteTranslator;

const isChatKey = (key: string): key is SiteChatMessageKey => key in chatMessages;
const isChatPluralKey = (key: string): key is SiteChatPluralKey => key in chatPluralMessages;

export function siteChatT(language?: string): SiteChatTranslator {
  const locale = resolveLocale(language) ?? 'en';
  const site = siteT(language) as (key: string, variables?: MessageVariables) => string;
  // The overloads check keys at each call site; this only dispatches.
  const translate = (key: string, variables?: MessageVariables): string => {
    if (isChatPluralKey(key)) {
      const count = Number(variables?.count ?? 0);
      const form = new Intl.PluralRules(locale).select(count);
      return (chatPluralMessages[key] as unknown as MessageFn)({ count, form }, { locale });
    }
    return isChatKey(key) ? chatMessages[key](undefined, { locale }) : site(key, variables);
  };
  return translate as SiteChatTranslator;
}
