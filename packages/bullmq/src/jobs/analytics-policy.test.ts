import { describe, expect, it } from 'vitest';
import { analyticsEventJobOptions, shouldShedAnalyticsEvent } from './analytics-policy';

describe('analytics queue durability policy', () => {
  it('retains failed jobs and budgets at least a day of fixed storage retries', () => {
    expect(analyticsEventJobOptions.attempts * analyticsEventJobOptions.backoff.delay).toBeGreaterThanOrEqual(86_400_000);
    expect(analyticsEventJobOptions.removeOnFail).toBe(false);
  });
  it('sheds crawler, vital, engagement telemetry in that order', () => {
    expect(shouldShedAnalyticsEvent('crawler_request', 10_000)).toBe(true);
    expect(shouldShedAnalyticsEvent('web_vitals', 10_000)).toBe(false);
    expect(shouldShedAnalyticsEvent('web_vitals', 50_000)).toBe(true);
    expect(shouldShedAnalyticsEvent('page_engaged', 50_000)).toBe(false);
    expect(shouldShedAnalyticsEvent('page_engaged', 100_000)).toBe(true);
    for (const name of ['page_view', 'search_query_submitted', 'search_result_clicked', 'feedback_submitted'])
      expect(shouldShedAnalyticsEvent(name, 1_000_000)).toBe(false);
  });
});
