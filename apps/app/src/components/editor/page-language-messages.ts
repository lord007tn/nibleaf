// Text written in the PAGE's language, which can be any locale and differ from
// the dashboard's: inserted block scaffolds, empty-block placeholders and the
// default group name. The active dashboard catalog cannot answer these.

import type { MessageVariables } from '@nibleaf/i18n/locale-state';
import type { Locale } from '@nibleaf/i18n/locales';
import { editor_newgroup } from '@nibleaf/i18n/messages/editor_newgroup';
import { editor_placeholder_body } from '@nibleaf/i18n/messages/editor_placeholder_body';
import { editor_placeholder_heading } from '@nibleaf/i18n/messages/editor_placeholder_heading';
import { editor_slash_default_badge } from '@nibleaf/i18n/messages/editor_slash_default_badge';
import { editor_slash_default_button } from '@nibleaf/i18n/messages/editor_slash_default_button';
import { editor_slash_default_cardn } from '@nibleaf/i18n/messages/editor_slash_default_cardn';
import { editor_slash_default_cardtitle } from '@nibleaf/i18n/messages/editor_slash_default_cardtitle';
import { editor_slash_default_columnn } from '@nibleaf/i18n/messages/editor_slash_default_columnn';
import { editor_slash_default_firstsection } from '@nibleaf/i18n/messages/editor_slash_default_firstsection';
import { editor_slash_default_firststep } from '@nibleaf/i18n/messages/editor_slash_default_firststep';
import { editor_slash_default_firsttab } from '@nibleaf/i18n/messages/editor_slash_default_firsttab';
import { editor_slash_default_secondsection } from '@nibleaf/i18n/messages/editor_slash_default_secondsection';
import { editor_slash_default_secondstep } from '@nibleaf/i18n/messages/editor_slash_default_secondstep';
import { editor_slash_default_secondtab } from '@nibleaf/i18n/messages/editor_slash_default_secondtab';
import { editor_slash_default_showdetails } from '@nibleaf/i18n/messages/editor_slash_default_showdetails';
import { editor_slash_default_term } from '@nibleaf/i18n/messages/editor_slash_default_term';
import { editor_slash_default_tooltiptext } from '@nibleaf/i18n/messages/editor_slash_default_tooltiptext';
import { editor_untitled } from '@nibleaf/i18n/messages/editor_untitled';
import { scopedTranslate } from '@nibleaf/i18n/scoped';

export const PAGE_LANGUAGE_MESSAGES = {
  'editor.newGroup': editor_newgroup,
  'editor.placeholder.body': editor_placeholder_body,
  'editor.placeholder.heading': editor_placeholder_heading,
  'editor.slash.default.badge': editor_slash_default_badge,
  'editor.slash.default.button': editor_slash_default_button,
  'editor.slash.default.cardN': editor_slash_default_cardn,
  'editor.slash.default.cardTitle': editor_slash_default_cardtitle,
  'editor.slash.default.columnN': editor_slash_default_columnn,
  'editor.slash.default.firstSection': editor_slash_default_firstsection,
  'editor.slash.default.firstStep': editor_slash_default_firststep,
  'editor.slash.default.firstTab': editor_slash_default_firsttab,
  'editor.slash.default.secondSection': editor_slash_default_secondsection,
  'editor.slash.default.secondStep': editor_slash_default_secondstep,
  'editor.slash.default.secondTab': editor_slash_default_secondtab,
  'editor.slash.default.showDetails': editor_slash_default_showdetails,
  'editor.slash.default.term': editor_slash_default_term,
  'editor.slash.default.tooltipText': editor_slash_default_tooltiptext,
  'editor.untitled': editor_untitled,
} as const;

export type PageLanguageMessageKey = keyof typeof PAGE_LANGUAGE_MESSAGES;

export const pageLanguageText = (key: PageLanguageMessageKey, locale: Locale, variables?: MessageVariables): string =>
  scopedTranslate(PAGE_LANGUAGE_MESSAGES, key, variables, locale);
