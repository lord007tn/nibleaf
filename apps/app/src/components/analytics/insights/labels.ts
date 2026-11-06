import type { MessageKey } from '@nibleaf/i18n';
import type {
  AiAssistantSource,
  CrawledResource,
  CrawlerCategory,
  PageAttentionReason,
  SearchTermsVisibility,
  TrafficChannel,
} from '@/hooks/api/analytics';

export const CHANNEL_LABELS: Record<TrafficChannel, MessageKey> = {
  direct: 'analytics.channel.direct',
  search: 'analytics.channel.search',
  ai_assistant: 'analytics.channel.aiAssistant',
  social: 'analytics.channel.social',
  referral: 'analytics.channel.referral',
  internal: 'analytics.channel.internal',
  campaign: 'analytics.channel.campaign',
};

/** Product names stay in their own spelling in every language. */
export const AI_SOURCE_NAMES: Record<AiAssistantSource, string | null> = {
  chatgpt: 'ChatGPT',
  perplexity: 'Perplexity',
  claude: 'Claude',
  gemini: 'Gemini',
  copilot: 'Copilot',
  deepseek: 'DeepSeek',
  grok: 'Grok',
  meta_ai: 'Meta AI',
  mistral: 'Mistral',
  you: 'You.com',
  phind: 'Phind',
  other_ai: null,
};

export const REASON_LABELS: Record<PageAttentionReason, MessageKey> = {
  low_helpfulness: 'analytics.reason.lowHelpfulness',
  high_exit: 'analytics.reason.highExit',
  low_engagement: 'analytics.reason.lowEngagement',
  search_bounce: 'analytics.reason.searchBounce',
  slow: 'analytics.reason.slow',
};

export const REASON_HINTS: Record<PageAttentionReason, MessageKey> = {
  low_helpfulness: 'analytics.reason.lowHelpfulness.hint',
  high_exit: 'analytics.reason.highExit.hint',
  low_engagement: 'analytics.reason.lowEngagement.hint',
  search_bounce: 'analytics.reason.searchBounce.hint',
  slow: 'analytics.reason.slow.hint',
};

export const CRAWLER_CATEGORY_LABELS: Record<CrawlerCategory, MessageKey> = {
  ai_training: 'analytics.crawler.aiTraining',
  ai_search: 'analytics.crawler.aiSearch',
  ai_assistant: 'analytics.crawler.aiAssistant',
  search_engine: 'analytics.crawler.searchEngine',
  seo: 'analytics.crawler.seo',
  social: 'analytics.crawler.social',
  monitor: 'analytics.crawler.monitor',
  other: 'analytics.crawler.other',
};

export const RESOURCE_LABELS: Record<CrawledResource, MessageKey> = {
  page: 'analytics.resource.page',
  markdown: 'analytics.resource.markdown',
  llms_txt: 'analytics.resource.llmsTxt',
  llms_full_txt: 'analytics.resource.llmsFullTxt',
  sitemap: 'analytics.resource.sitemap',
  robots: 'analytics.resource.robots',
  openapi: 'analytics.resource.openapi',
  rss: 'analytics.resource.rss',
  other: 'analytics.resource.other',
};

const DEVICE_LABELS: Record<string, MessageKey> = {
  desktop: 'analytics.device.desktop',
  mobile: 'analytics.device.mobile',
  tablet: 'analytics.device.tablet',
  unknown: 'analytics.device.unknown',
};

export const deviceLabelKey = (device: string): MessageKey | null => DEVICE_LABELS[device] ?? null;

export const HIDDEN_TERMS_EXPLANATION: Record<Exclude<SearchTermsVisibility, 'visible'>, MessageKey> = {
  disabled_by_setting: 'analytics.search.hidden.disabled',
  private_site: 'analytics.search.hidden.private',
};

/** A language code's name in the interface language ("ar" → "Arabic"), falling back to the code. */
export function languageName(code: string, displayLocale: string): string {
  if (!code || code === 'unknown') return code;
  try {
    return new Intl.DisplayNames([displayLocale], { type: 'language' }).of(code) ?? code.toUpperCase();
  } catch {
    return code.toUpperCase();
  }
}
