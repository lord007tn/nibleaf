// Slash commands are found by their title in the page language, the interface
// language, English and Arabic at once, so every locale must answer synchronously.

import type { MessageVariables } from '@nibleaf/i18n/locale-state';
import type { Locale } from '@nibleaf/i18n/locales';
import { editor_slash_accordion_title } from '@nibleaf/i18n/messages/editor_slash_accordion_title';
import { editor_slash_apiexample_title } from '@nibleaf/i18n/messages/editor_slash_apiexample_title';
import { editor_slash_badge_title } from '@nibleaf/i18n/messages/editor_slash_badge_title';
import { editor_slash_banner_title } from '@nibleaf/i18n/messages/editor_slash_banner_title';
import { editor_slash_bulletlist_title } from '@nibleaf/i18n/messages/editor_slash_bulletlist_title';
import { editor_slash_button_title } from '@nibleaf/i18n/messages/editor_slash_button_title';
import { editor_slash_card_title } from '@nibleaf/i18n/messages/editor_slash_card_title';
import { editor_slash_cardgrid3_title } from '@nibleaf/i18n/messages/editor_slash_cardgrid3_title';
import { editor_slash_cardgrid4_title } from '@nibleaf/i18n/messages/editor_slash_cardgrid4_title';
import { editor_slash_cardgroup_title } from '@nibleaf/i18n/messages/editor_slash_cardgroup_title';
import { editor_slash_check_title } from '@nibleaf/i18n/messages/editor_slash_check_title';
import { editor_slash_codeblock_title } from '@nibleaf/i18n/messages/editor_slash_codeblock_title';
import { editor_slash_codegroup_title } from '@nibleaf/i18n/messages/editor_slash_codegroup_title';
import { editor_slash_columns2_title } from '@nibleaf/i18n/messages/editor_slash_columns2_title';
import { editor_slash_columns3_title } from '@nibleaf/i18n/messages/editor_slash_columns3_title';
import { editor_slash_columns4_title } from '@nibleaf/i18n/messages/editor_slash_columns4_title';
import { editor_slash_danger_title } from '@nibleaf/i18n/messages/editor_slash_danger_title';
import { editor_slash_divider_title } from '@nibleaf/i18n/messages/editor_slash_divider_title';
import { editor_slash_embed_title } from '@nibleaf/i18n/messages/editor_slash_embed_title';
import { editor_slash_expandable_title } from '@nibleaf/i18n/messages/editor_slash_expandable_title';
import { editor_slash_file_title } from '@nibleaf/i18n/messages/editor_slash_file_title';
import { editor_slash_filetree_title } from '@nibleaf/i18n/messages/editor_slash_filetree_title';
import { editor_slash_folder_title } from '@nibleaf/i18n/messages/editor_slash_folder_title';
import { editor_slash_frame_title } from '@nibleaf/i18n/messages/editor_slash_frame_title';
import { editor_slash_h1_title } from '@nibleaf/i18n/messages/editor_slash_h1_title';
import { editor_slash_h2_title } from '@nibleaf/i18n/messages/editor_slash_h2_title';
import { editor_slash_h3_title } from '@nibleaf/i18n/messages/editor_slash_h3_title';
import { editor_slash_icon_title } from '@nibleaf/i18n/messages/editor_slash_icon_title';
import { editor_slash_image_title } from '@nibleaf/i18n/messages/editor_slash_image_title';
import { editor_slash_info_title } from '@nibleaf/i18n/messages/editor_slash_info_title';
import { editor_slash_mermaid_title } from '@nibleaf/i18n/messages/editor_slash_mermaid_title';
import { editor_slash_note_title } from '@nibleaf/i18n/messages/editor_slash_note_title';
import { editor_slash_numberedlist_title } from '@nibleaf/i18n/messages/editor_slash_numberedlist_title';
import { editor_slash_paramfield_title } from '@nibleaf/i18n/messages/editor_slash_paramfield_title';
import { editor_slash_quote_title } from '@nibleaf/i18n/messages/editor_slash_quote_title';
import { editor_slash_relatedcard_title } from '@nibleaf/i18n/messages/editor_slash_relatedcard_title';
import { editor_slash_relatedcontent_title } from '@nibleaf/i18n/messages/editor_slash_relatedcontent_title';
import { editor_slash_requestexample_title } from '@nibleaf/i18n/messages/editor_slash_requestexample_title';
import { editor_slash_responseexample_title } from '@nibleaf/i18n/messages/editor_slash_responseexample_title';
import { editor_slash_responsefield_title } from '@nibleaf/i18n/messages/editor_slash_responsefield_title';
import { editor_slash_steps_title } from '@nibleaf/i18n/messages/editor_slash_steps_title';
import { editor_slash_table_title } from '@nibleaf/i18n/messages/editor_slash_table_title';
import { editor_slash_tabs_title } from '@nibleaf/i18n/messages/editor_slash_tabs_title';
import { editor_slash_text_title } from '@nibleaf/i18n/messages/editor_slash_text_title';
import { editor_slash_tip_title } from '@nibleaf/i18n/messages/editor_slash_tip_title';
import { editor_slash_todo_title } from '@nibleaf/i18n/messages/editor_slash_todo_title';
import { editor_slash_tooltip_title } from '@nibleaf/i18n/messages/editor_slash_tooltip_title';
import { editor_slash_update_title } from '@nibleaf/i18n/messages/editor_slash_update_title';
import { editor_slash_video_title } from '@nibleaf/i18n/messages/editor_slash_video_title';
import { editor_slash_warning_title } from '@nibleaf/i18n/messages/editor_slash_warning_title';
import { scopedTranslate } from '@nibleaf/i18n/scoped';

export const SLASH_TITLE_MESSAGES = {
  'editor.slash.accordion.title': editor_slash_accordion_title,
  'editor.slash.apiExample.title': editor_slash_apiexample_title,
  'editor.slash.badge.title': editor_slash_badge_title,
  'editor.slash.banner.title': editor_slash_banner_title,
  'editor.slash.bulletList.title': editor_slash_bulletlist_title,
  'editor.slash.button.title': editor_slash_button_title,
  'editor.slash.card.title': editor_slash_card_title,
  'editor.slash.cardGrid3.title': editor_slash_cardgrid3_title,
  'editor.slash.cardGrid4.title': editor_slash_cardgrid4_title,
  'editor.slash.cardGroup.title': editor_slash_cardgroup_title,
  'editor.slash.check.title': editor_slash_check_title,
  'editor.slash.codeBlock.title': editor_slash_codeblock_title,
  'editor.slash.codeGroup.title': editor_slash_codegroup_title,
  'editor.slash.columns2.title': editor_slash_columns2_title,
  'editor.slash.columns3.title': editor_slash_columns3_title,
  'editor.slash.columns4.title': editor_slash_columns4_title,
  'editor.slash.danger.title': editor_slash_danger_title,
  'editor.slash.divider.title': editor_slash_divider_title,
  'editor.slash.embed.title': editor_slash_embed_title,
  'editor.slash.expandable.title': editor_slash_expandable_title,
  'editor.slash.file.title': editor_slash_file_title,
  'editor.slash.fileTree.title': editor_slash_filetree_title,
  'editor.slash.folder.title': editor_slash_folder_title,
  'editor.slash.frame.title': editor_slash_frame_title,
  'editor.slash.h1.title': editor_slash_h1_title,
  'editor.slash.h2.title': editor_slash_h2_title,
  'editor.slash.h3.title': editor_slash_h3_title,
  'editor.slash.icon.title': editor_slash_icon_title,
  'editor.slash.image.title': editor_slash_image_title,
  'editor.slash.info.title': editor_slash_info_title,
  'editor.slash.mermaid.title': editor_slash_mermaid_title,
  'editor.slash.note.title': editor_slash_note_title,
  'editor.slash.numberedList.title': editor_slash_numberedlist_title,
  'editor.slash.paramField.title': editor_slash_paramfield_title,
  'editor.slash.quote.title': editor_slash_quote_title,
  'editor.slash.relatedCard.title': editor_slash_relatedcard_title,
  'editor.slash.relatedContent.title': editor_slash_relatedcontent_title,
  'editor.slash.requestExample.title': editor_slash_requestexample_title,
  'editor.slash.responseExample.title': editor_slash_responseexample_title,
  'editor.slash.responseField.title': editor_slash_responsefield_title,
  'editor.slash.steps.title': editor_slash_steps_title,
  'editor.slash.table.title': editor_slash_table_title,
  'editor.slash.tabs.title': editor_slash_tabs_title,
  'editor.slash.text.title': editor_slash_text_title,
  'editor.slash.tip.title': editor_slash_tip_title,
  'editor.slash.todo.title': editor_slash_todo_title,
  'editor.slash.tooltip.title': editor_slash_tooltip_title,
  'editor.slash.update.title': editor_slash_update_title,
  'editor.slash.video.title': editor_slash_video_title,
  'editor.slash.warning.title': editor_slash_warning_title,
} as const;

export type SlashTitleKey = keyof typeof SLASH_TITLE_MESSAGES;

/** The title in `locale`, or in the interface language when none is given. */
export const slashTitleText = (key: SlashTitleKey, locale?: Locale, variables?: MessageVariables): string =>
  scopedTranslate(SLASH_TITLE_MESSAGES, key, variables, locale);
