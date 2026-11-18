// The Theme preview shows either direction whatever the dashboard language is,
// so its copy cannot depend on the active dashboard catalog.

import type { MessageVariables } from '@nibleaf/i18n/locale-state';
import type { Locale } from '@nibleaf/i18n/locales';
import { settings_theme_preview_authentication } from '@nibleaf/i18n/messages/settings_theme_preview_authentication';
import { settings_theme_preview_body } from '@nibleaf/i18n/messages/settings_theme_preview_body';
import { settings_theme_preview_callout } from '@nibleaf/i18n/messages/settings_theme_preview_callout';
import { settings_theme_preview_guide } from '@nibleaf/i18n/messages/settings_theme_preview_guide';
import { settings_theme_preview_navigation } from '@nibleaf/i18n/messages/settings_theme_preview_navigation';
import { settings_theme_preview_next } from '@nibleaf/i18n/messages/settings_theme_preview_next';
import { settings_theme_preview_overview } from '@nibleaf/i18n/messages/settings_theme_preview_overview';
import { settings_theme_preview_productdocs } from '@nibleaf/i18n/messages/settings_theme_preview_productdocs';
import { settings_theme_preview_publish } from '@nibleaf/i18n/messages/settings_theme_preview_publish';
import { settings_theme_preview_search } from '@nibleaf/i18n/messages/settings_theme_preview_search';
import { settings_theme_preview_start } from '@nibleaf/i18n/messages/settings_theme_preview_start';
import { settings_theme_preview_switcharabic } from '@nibleaf/i18n/messages/settings_theme_preview_switcharabic';
import { settings_theme_preview_switchenglish } from '@nibleaf/i18n/messages/settings_theme_preview_switchenglish';
import { settings_theme_preview_title } from '@nibleaf/i18n/messages/settings_theme_preview_title';
import { scopedTranslate } from '@nibleaf/i18n/scoped';

export const THEME_PREVIEW_MESSAGES = {
  'settings.theme.preview.authentication': settings_theme_preview_authentication,
  'settings.theme.preview.body': settings_theme_preview_body,
  'settings.theme.preview.callout': settings_theme_preview_callout,
  'settings.theme.preview.guide': settings_theme_preview_guide,
  'settings.theme.preview.navigation': settings_theme_preview_navigation,
  'settings.theme.preview.next': settings_theme_preview_next,
  'settings.theme.preview.overview': settings_theme_preview_overview,
  'settings.theme.preview.productDocs': settings_theme_preview_productdocs,
  'settings.theme.preview.publish': settings_theme_preview_publish,
  'settings.theme.preview.search': settings_theme_preview_search,
  'settings.theme.preview.start': settings_theme_preview_start,
  'settings.theme.preview.switchArabic': settings_theme_preview_switcharabic,
  'settings.theme.preview.switchEnglish': settings_theme_preview_switchenglish,
  'settings.theme.preview.title': settings_theme_preview_title,
} as const;

export type ThemePreviewMessageKey = keyof typeof THEME_PREVIEW_MESSAGES;

export const themePreviewText = (key: ThemePreviewMessageKey, locale: Extract<Locale, 'ar' | 'en'>, variables?: MessageVariables): string =>
  scopedTranslate(THEME_PREVIEW_MESSAGES, key, variables, locale);
