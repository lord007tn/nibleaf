// Blog chrome follows the article's language, not the visitor's, and marketing
// pages never load a dashboard catalog. These named messages carry every locale
// synchronously, so the server HTML and the first browser render always agree.

import type { MessageVariables } from '@nibleaf/i18n/locale-state';
import type { Locale } from '@nibleaf/i18n/locales';
import { blog_allarticles } from '@nibleaf/i18n/messages/blog_allarticles';
import { blog_by } from '@nibleaf/i18n/messages/blog_by';
import { blog_copylink } from '@nibleaf/i18n/messages/blog_copylink';
import { blog_createaccount } from '@nibleaf/i18n/messages/blog_createaccount';
import { blog_ctabody } from '@nibleaf/i18n/messages/blog_ctabody';
import { blog_ctatitle } from '@nibleaf/i18n/messages/blog_ctatitle';
import { blog_description } from '@nibleaf/i18n/messages/blog_description';
import { blog_eyebrow } from '@nibleaf/i18n/messages/blog_eyebrow';
import { blog_faqtitle } from '@nibleaf/i18n/messages/blog_faqtitle';
import { blog_linkcopied } from '@nibleaf/i18n/messages/blog_linkcopied';
import { blog_noresults } from '@nibleaf/i18n/messages/blog_noresults';
import { blog_published } from '@nibleaf/i18n/messages/blog_published';
import { blog_readingminutes } from '@nibleaf/i18n/messages/blog_readingminutes';
import { blog_readnext } from '@nibleaf/i18n/messages/blog_readnext';
import { blog_searchlabel } from '@nibleaf/i18n/messages/blog_searchlabel';
import { blog_searchplaceholder } from '@nibleaf/i18n/messages/blog_searchplaceholder';
import { blog_selfhostingguide } from '@nibleaf/i18n/messages/blog_selfhostingguide';
import { blog_share } from '@nibleaf/i18n/messages/blog_share';
import { blog_sharelinkedin } from '@nibleaf/i18n/messages/blog_sharelinkedin';
import { blog_sharex } from '@nibleaf/i18n/messages/blog_sharex';
import { blog_team } from '@nibleaf/i18n/messages/blog_team';
import { blog_title } from '@nibleaf/i18n/messages/blog_title';
import { blog_updated } from '@nibleaf/i18n/messages/blog_updated';
import { scopedTranslate } from '@nibleaf/i18n/scoped';

export const BLOG_MESSAGES = {
  'blog.allArticles': blog_allarticles,
  'blog.by': blog_by,
  'blog.copyLink': blog_copylink,
  'blog.createAccount': blog_createaccount,
  'blog.ctaBody': blog_ctabody,
  'blog.ctaTitle': blog_ctatitle,
  'blog.description': blog_description,
  'blog.eyebrow': blog_eyebrow,
  'blog.faqTitle': blog_faqtitle,
  'blog.linkCopied': blog_linkcopied,
  'blog.noResults': blog_noresults,
  'blog.published': blog_published,
  'blog.readNext': blog_readnext,
  'blog.readingMinutes': blog_readingminutes,
  'blog.searchLabel': blog_searchlabel,
  'blog.searchPlaceholder': blog_searchplaceholder,
  'blog.selfHostingGuide': blog_selfhostingguide,
  'blog.share': blog_share,
  'blog.shareLinkedIn': blog_sharelinkedin,
  'blog.shareX': blog_sharex,
  'blog.team': blog_team,
  'blog.title': blog_title,
  'blog.updated': blog_updated,
} as const;

export type BlogMessageKey = keyof typeof BLOG_MESSAGES;

export const blogText = (key: BlogMessageKey, language: Extract<Locale, 'ar' | 'en'>, variables?: MessageVariables): string =>
  scopedTranslate(BLOG_MESSAGES, key, variables, language);
