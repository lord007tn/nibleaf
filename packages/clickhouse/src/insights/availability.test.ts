import { afterEach, expect, it, vi } from 'vitest';
import { resolveInsightsMeta } from './period';
import { queryOverviewInsights } from './queries';
import type { InsightsScope } from './reader';

const ready = vi.hoisted(() => vi.fn(async () => false));
vi.mock('./reader', () => ({
  InsightsReader: class {
    ready = ready;
    meta = () => ({ ...resolveInsightsMeta({ range: '7d', timezone: 'UTC', compare: 'previous' }), availability: 'partial' });
  },
}));
afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

it.each([
  ['disabled', 'not_configured'],
  ['dual_write', 'reads_disabled'],
  ['clickhouse', 'partial'],
] as const)('reports %s mode as %s', async (mode, expected) => {
  vi.stubEnv('ANALYTICS_MODE', mode);
  const scope: InsightsScope = {
    tenantId: 't',
    projectId: 'p',
    visibility: 'visible',
    titles: new Map(),
    meta: resolveInsightsMeta({ range: '7d', timezone: 'UTC', compare: 'previous' }),
  };
  const result = await queryOverviewInsights(scope);
  expect(result.meta.availability).toBe(expected);
  expect(ready).toHaveBeenCalledTimes(mode === 'clickhouse' ? 1 : 0);
});
