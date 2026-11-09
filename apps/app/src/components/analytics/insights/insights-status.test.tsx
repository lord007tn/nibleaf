// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const queries = vi.hoisted(() => ({ deployments: [] as Array<{ status: string }>, project: undefined as { readyPublishes?: number } | undefined }));
vi.mock('@nibleaf/i18n/react', () => ({ useLocale: () => ({ t: (key: string) => key, locale: 'en' }), useT: () => (key: string) => key }));
vi.mock('@/hooks/api', () => ({
  useDeployments: () => ({ data: queries.deployments }),
  useProject: () => ({ data: queries.project }),
}));
vi.mock('./use-insight-format', () => ({ useInsightFormat: () => ({ dateTime: () => 'then', relativeTime: () => '3 days ago' }) }));

import { InsightsStatus } from './insights-status';

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);

describe('stale analytics notice', () => {
  let container: HTMLDivElement;
  let root: Root;
  // Last event three days ago: stale for a live site.
  const state = {
    loading: false,
    availability: 'complete' as const,
    unknown: false,
    lastEventAt: new Date(Date.now() - 3 * 86_400_000).toISOString(),
  };

  beforeEach(() => {
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  it('warns about a live site whose live publish is older than the newest 50 attempts', async () => {
    queries.deployments = Array.from({ length: 50 }, () => ({ status: 'FAILED' }));
    queries.project = { readyPublishes: 2 };
    await act(async () => root.render(<InsightsStatus projectId="p1" state={state} />));
    expect(container.textContent).toContain('analytics.freshness.stale.title');
  });

  it('stays quiet for a site that never went live', async () => {
    queries.deployments = [{ status: 'FAILED' }];
    queries.project = { readyPublishes: 0 };
    await act(async () => root.render(<InsightsStatus projectId="p1" state={state} />));
    expect(container.textContent).not.toContain('analytics.freshness.stale.title');
    expect(container.textContent).toContain('analytics.freshness.lastReceived');
  });
});
