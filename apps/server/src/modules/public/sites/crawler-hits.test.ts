import { afterEach, describe, expect, it, vi } from 'vitest';

const record = vi.hoisted(() => vi.fn(async (..._args: unknown[]) => undefined));
vi.mock('@/actions/sites', () => ({ recordCrawlerRequest: record }));

import { enqueueCrawlerHit, hasInternalAnalyticsProof } from './crawler-hits';

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  record.mockClear();
});
describe('API crawler admission', () => {
  it('requires a configured exact proof; a guessed suppression header is ineffective', () => {
    vi.stubEnv('INTERNAL_API_SECRET', 'fictional-proof');
    expect(hasInternalAnalyticsProof('fictional-proof')).toBe(true);
    expect(hasInternalAnalyticsProof('guessed')).toBe(false);
    vi.stubEnv('INTERNAL_API_SECRET', '');
    expect(hasInternalAnalyticsProof('')).toBe(false);
  });
  it('only queues classified requests and persists response metadata without UA payload', async () => {
    vi.useFakeTimers();
    const hit = {
      identifier: 'p',
      eventId: '00000000-0000-4000-8000-000000000001',
      occurredAt: new Date().toISOString(),
      path: 'llms.txt',
      userAgent: 'GPTBot/1',
      statusCode: 200,
      contentType: 'text/plain',
      durationMs: 4,
    };
    expect(enqueueCrawlerHit({ ...hit, userAgent: 'Mozilla/5.0' })).toBe(false);
    expect(enqueueCrawlerHit(hit)).toBe(true);
    expect(record).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(250);
    expect(record).toHaveBeenCalledWith(
      'p',
      expect.objectContaining({ name: 'crawler_request', resource: 'llms_txt', statusCode: 200, contentType: 'text/plain', durationMs: 4 }),
      expect.objectContaining({ userAgent: 'GPTBot/1' }),
    );
    expect(record.mock.calls[0]?.[1]).not.toHaveProperty('userAgent');
  });
});
