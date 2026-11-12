import { describe, expect, it, vi } from 'vitest';

vi.mock('@/services/api', () => ({ api: {} }));

import { workspaceAiQueryOptions } from '@/hooks/api/query-options';
import { siteAiQueryOptions } from './query-options';

const overview = (preparation: 'none' | 'running' | 'ready' | 'failed') => ({
  selectedProvider: 'instance',
  capabilities: { answers: { available: true, reason: null } },
  status: { preparation: { state: preparation, pages: 0, at: null } },
});

describe('siteAiQueryOptions', () => {
  it('reads the same cache entry as Smart AI, so nothing is fetched twice', () => {
    expect(siteAiQueryOptions('site').queryKey).toEqual(workspaceAiQueryOptions('site').queryKey);
  });

  it('hands the model only the capabilities and status', () => {
    const select = siteAiQueryOptions('site').select as (data: unknown) => unknown;
    expect(select(overview('ready'))).toEqual({
      capabilities: { answers: { available: true, reason: null } },
      status: { preparation: { state: 'ready', pages: 0, at: null } },
    });
  });

  it.each([
    ['running', 3000],
    ['ready', false],
    ['failed', false],
    ['none', false],
  ] as const)('polls while the docs are being prepared (%s → %s)', (state, interval) => {
    const refetchInterval = siteAiQueryOptions('site').refetchInterval as (query: { state: { data: unknown } }) => unknown;
    expect(refetchInterval({ state: { data: overview(state) } })).toBe(interval);
  });
});
