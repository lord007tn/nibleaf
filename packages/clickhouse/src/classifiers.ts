import type { AiAssistantSource, CrawledResource, CrawlerCategory, TrafficChannel } from './insights/types';

export const crawlerPolicyTokens = [
  { token: 'Google-Extended', policyOnly: true },
  { token: 'Applebot-Extended', policyOnly: true },
] as const;

/** Ordered: extended/user/search agents must win over their broader family. UA
 * identity is a claim, never IP verification. Keep this catalog dependency-free. */
const catalog: Array<[string, string, CrawlerCategory]> = [
  ['GPTBot', 'OpenAI', 'ai_training'],
  ['OAI-SearchBot', 'OpenAI', 'ai_search'],
  ['ChatGPT-User', 'OpenAI', 'ai_assistant'],
  ['Claude-SearchBot', 'Anthropic', 'ai_search'],
  ['Claude-User', 'Anthropic', 'ai_assistant'],
  ['ClaudeBot', 'Anthropic', 'ai_training'],
  ['anthropic-ai', 'Anthropic', 'ai_training'],
  ['Perplexity-User', 'Perplexity', 'ai_assistant'],
  ['PerplexityBot', 'Perplexity', 'ai_search'],
  ['Googlebot', 'Google', 'search_engine'],
  ['GoogleOther', 'Google', 'other'],
  ['Bingbot', 'Microsoft', 'search_engine'],
  ['Applebot', 'Apple', 'search_engine'],
  ['CCBot', 'Common Crawl', 'ai_training'],
  ['Bytespider', 'ByteDance', 'ai_training'],
  ['Amazonbot', 'Amazon', 'ai_training'],
  ['Meta-ExternalAgent', 'Meta', 'ai_training'],
  ['FacebookBot', 'Meta', 'social'],
  ['DuckAssistBot', 'DuckDuckGo', 'ai_search'],
  ['cohere-ai', 'Cohere', 'ai_training'],
  ['MistralAI-User', 'Mistral', 'ai_assistant'],
  ['YouBot', 'You.com', 'ai_search'],
  ['Diffbot', 'Diffbot', 'ai_training'],
  ['Timpibot', 'Timpi', 'ai_training'],
  ['ImagesiftBot', 'Imagesift', 'ai_training'],
  ['PetalBot', 'Huawei', 'search_engine'],
  ['YandexBot', 'Yandex', 'search_engine'],
  ['Baiduspider', 'Baidu', 'search_engine'],
  ['SemrushBot', 'Semrush', 'seo'],
  ['AhrefsBot', 'Ahrefs', 'seo'],
];

export interface ActorClassification {
  actorType: 'human' | 'bot';
  botName: string;
  botOperator: string;
  botCategory: CrawlerCategory | '';
  verification: 'claimed';
}

export const classifyUserAgent = (userAgent?: string | null): ActorClassification => {
  const ua = crawlerPolicyTokens.reduce(
    (value, { token }) => value.replaceAll(token.toLowerCase(), ''),
    (userAgent ?? '').slice(0, 2048).toLowerCase(),
  );
  // Policy-only tokens have no request identity. Do not let the generic bot
  // heuristic (or Applebot's broader name) turn a bare token into a crawler.

  const match = catalog.find(([name]) => ua.includes(name.toLowerCase()));
  if (match) return { actorType: 'bot', botName: match[0], botOperator: match[1], botCategory: match[2], verification: 'claimed' };
  const automated =
    /bot\b|crawler|spider|headless|phantomjs|selenium|playwright|puppeteer|curl\/|wget\/|python[-/ ]|httpx|aiohttp|go-http-client|okhttp|libwww|apache-httpclient|node-fetch|undici|scrapy/iu.test(
      ua,
    );
  const monitor = /uptimerobot|healthcheck|pingdom|statuscake/iu.test(ua);
  return {
    actorType: automated || monitor ? 'bot' : 'human',
    botName: monitor ? 'Monitor' : automated ? 'Other bot' : '',
    botOperator: '',
    botCategory: monitor ? 'monitor' : automated ? 'other' : '',
    verification: 'claimed',
  };
};

const assistantHosts: Array<[string, AiAssistantSource]> = [
  ['chatgpt.com', 'chatgpt'],
  ['openai.com', 'chatgpt'],
  ['perplexity.ai', 'perplexity'],
  ['claude.ai', 'claude'],
  ['gemini.google.com', 'gemini'],
  ['bard.google.com', 'gemini'],
  ['copilot.microsoft.com', 'copilot'],
  ['deepseek.com', 'deepseek'],
  ['grok.com', 'grok'],
  ['meta.ai', 'meta_ai'],
  ['mistral.ai', 'mistral'],
  ['you.com', 'you'],
  ['phind.com', 'phind'],
];
const hostOf = (value?: string): string => {
  if (!value) return '';
  try {
    return new URL(value.includes('://') ? value : `https://${value}`).hostname.toLowerCase();
  } catch {
    return '';
  }
};
const isHost = (host: string, domain: string) => host === domain || host.endsWith(`.${domain}`);

export const classifyReferral = (
  referrer?: string,
  utmSource?: string,
  siteHost?: string,
): { channel: TrafficChannel; aiSource: AiAssistantSource | '' } => {
  const host = hostOf(referrer);
  const campaign = hostOf(utmSource);
  const assistant = assistantHosts.find(([domain]) => isHost(campaign, domain) || isHost(host, domain));
  if (assistant) return { channel: 'ai_assistant', aiSource: assistant[1] };
  if (utmSource) return { channel: 'campaign', aiSource: '' };
  if (!host) return { channel: 'direct', aiSource: '' };
  if (siteHost && host === hostOf(siteHost)) return { channel: 'internal', aiSource: '' };
  if (/(^|\.)(google\.[a-z.]+|bing\.com|duckduckgo\.com|search\.yahoo\.com|baidu\.com|yandex\.[a-z.]+)$/u.test(host))
    return { channel: 'search', aiSource: '' };
  if (
    ['facebook.com', 'instagram.com', 'linkedin.com', 'twitter.com', 'x.com', 't.co', 'reddit.com', 'youtube.com'].some((domain) =>
      isHost(host, domain),
    )
  )
    return { channel: 'social', aiSource: '' };
  return { channel: 'referral', aiSource: '' };
};

/** Redact before hashing as well as storing, so equivalent private values cannot
 * become a high-cardinality identifier. Locale-independent case folding. */
export const normalizeSearchTerm = (term: string): string =>
  term
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/giu, '[email]')
    .replace(/(?:https?:\/\/|www\.)[^\s]+/giu, '[url]')
    .replace(/\d{6,}/gu, '[number]')
    .trim()
    .replace(/\s+/gu, ' ')
    .slice(0, 200);

export const classifyCrawledResource = (path: string): CrawledResource => {
  const clean = path.split('?')[0]?.toLowerCase() ?? '';
  if (clean.endsWith('/llms-full.txt')) return 'llms_full_txt';
  if (clean.endsWith('/llms.txt')) return 'llms_txt';
  if (clean.endsWith('/sitemap.xml')) return 'sitemap';
  if (clean.endsWith('/robots.txt')) return 'robots';
  if (clean.endsWith('/openapi.json')) return 'openapi';
  if (clean.endsWith('/rss.xml')) return 'rss';
  if (clean.endsWith('.md') || clean.endsWith('/markdown')) return 'markdown';
  return 'page';
};
