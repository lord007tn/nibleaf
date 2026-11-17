import { describe, expect, it } from 'vitest';
import { classifyCrawledResource, classifyReferral, classifyUserAgent, normalizeSearchTerm } from './classifiers';
import { buildAnalyticsEvent, publicAnalyticsEventSchema } from './events';

describe('server actor and referral classification', () => {
  it.each([
    ['GPTBot', 'ai_training'],
    ['OAI-SearchBot', 'ai_search'],
    ['ChatGPT-User', 'ai_assistant'],
    ['ClaudeBot', 'ai_training'],
    ['Claude-User', 'ai_assistant'],
    ['Claude-SearchBot', 'ai_search'],
    ['anthropic-ai', 'ai_training'],
    ['PerplexityBot', 'ai_search'],
    ['Perplexity-User', 'ai_assistant'],

    ['Googlebot', 'search_engine'],
    ['GoogleOther', 'other'],
    ['Bingbot', 'search_engine'],
    ['Applebot', 'search_engine'],

    ['CCBot', 'ai_training'],
    ['Bytespider', 'ai_training'],
    ['Amazonbot', 'ai_training'],
    ['Meta-ExternalAgent', 'ai_training'],
    ['FacebookBot', 'social'],
    ['DuckAssistBot', 'ai_search'],
    ['cohere-ai', 'ai_training'],
    ['MistralAI-User', 'ai_assistant'],
    ['YouBot', 'ai_search'],
    ['Diffbot', 'ai_training'],
    ['Timpibot', 'ai_training'],
    ['ImagesiftBot', 'ai_training'],
    ['PetalBot', 'search_engine'],
    ['YandexBot', 'search_engine'],
    ['Baiduspider', 'search_engine'],
    ['SemrushBot', 'seo'],
    ['AhrefsBot', 'seo'],
  ])('recognizes %s with a claimed identity', (ua, category) => {
    expect(classifyUserAgent(`Mozilla/5.0 (compatible; ${ua}/1.0)`)).toMatchObject({
      actorType: 'bot',
      botName: ua,
      botCategory: category,
      verification: 'claimed',
    });
  });
  it.each(['HeadlessChrome', 'python-requests/2', 'curl/8', 'Go-http-client/1.1', 'Unknown crawler', 'node-fetch/3', 'uptimerobot'])(
    'excludes automation %s',
    (ua) => {
      expect(classifyUserAgent(ua).actorType).toBe('bot');
    },
  );
  it('does not identify policy-only tokens as real request agents', () => {
    expect(classifyUserAgent('Google-Extended').actorType).toBe('human');
    expect(classifyUserAgent('Applebot-Extended').actorType).toBe('human');
  });
  it('keeps ordinary readers human', () => {
    expect(classifyUserAgent('Mozilla/5.0 Chrome/140 Safari/537.36').actorType).toBe('human');
  });
  it('matches domain boundaries and assistant campaign attribution', () => {
    expect(classifyReferral(undefined, 'chatgpt.com')).toEqual({ channel: 'ai_assistant', aiSource: 'chatgpt' });
    expect(classifyReferral('https://chatgpt.com.evil.example/')).toEqual({ channel: 'referral', aiSource: '' });
    expect(classifyReferral('https://www.google.com/search?q=test').channel).toBe('search');
    expect(classifyReferral('https://www.reddit.com/r/docs').channel).toBe('social');
    expect(classifyReferral('https://docs.example/a', undefined, 'docs.example').channel).toBe('internal');
    expect(classifyReferral().channel).toBe('direct');
    expect(classifyReferral(undefined, 'newsletter').channel).toBe('campaign');
  });
  it('redacts and folds terms before both hashing and storage, including not_required', () => {
    expect(normalizeSearchTerm('  ＡＰＩ   Foo@Example.COM https://secret.test/123 1234567  ')).toBe('api [email] [url] [number]');
    expect(normalizeSearchTerm('account \u0661\u0662\u0663\u0664\u0665\u0666\u0667')).toBe('account [number]');
    const context = {
      tenantId: 't',
      projectId: 'p',
      siteId: 'p',
      source: 'public_site' as const,
      hashSalt: 'test',
      privacy: { visibility: 'public' as const, allowCampaignDimensions: false, allowRawPublicSearchQueries: true },
    };
    const first = buildAnalyticsEvent(
      { consentState: 'not_required', payload: { name: 'search_query_submitted', query: ' ＡＰＩ   Token ' } },
      context,
    );
    const second = buildAnalyticsEvent({ consentState: 'granted', payload: { name: 'search_query_submitted', query: 'api token' } }, context);
    expect(first.queryHash).toBe(second.queryHash);
    expect(first.sensitiveQueryText).toBe('api token');
    expect(publicAnalyticsEventSchema.safeParse({ payload: { name: 'crawler_request', path: '/', resource: 'page', statusCode: 200 } }).success).toBe(
      false,
    );
    expect(publicAnalyticsEventSchema.safeParse({ payload: { name: 'web_vitals', lcpMs: 1000 } }).success).toBe(true);
  });
  it('retains assistant categories when campaign strings are stripped', () => {
    const event = buildAnalyticsEvent(
      { consentState: 'denied', payload: { name: 'page_view', utmSource: 'chatgpt.com' } },
      {
        tenantId: 't',
        projectId: 'p',
        siteId: 'p',
        source: 'api',
        hashSalt: 'test',
        userAgent: 'GPTBot',
        privacy: { visibility: 'public', allowCampaignDimensions: false, allowRawPublicSearchQueries: false },
      },
    );
    expect(event).toMatchObject({ actorType: 'bot', channel: 'ai_assistant', aiSource: 'chatgpt' });
    expect(event.payload).not.toHaveProperty('utmSource');
    expect(classifyCrawledResource('/sites/p/llms-full.txt?secret=x')).toBe('llms_full_txt');
  });
});

it.each(['\u7528\u6237@example.com', 'jos\u00e9.ni\u00f1o@correo.es', '"a b"@x.org', 'user@\u4f8b\u5b50.\u4e2d\u56fd'])(
  'redacts international email-like tokens: %s',
  (email) => {
    expect(normalizeSearchTerm(`find ${email} please`)).toBe('find [email] please');
  },
);
it('preserves ordinary version tokens without a dotted email domain', () => {
  expect(normalizeSearchTerm('api@v2')).toBe('api@v2');
});
it('keeps punctuation around redacted emails and handles several per token', () => {
  expect(normalizeSearchTerm('mail (a@b.co), then c@d.org.')).toBe('mail ([email]), then [email].');
  expect(normalizeSearchTerm('<x@y.io>,<z@w.io>')).toBe('<[email]>,<[email]>');
  expect(normalizeSearchTerm('@scope/pkg and user@host')).toBe('@scope/pkg and user@host');
});
