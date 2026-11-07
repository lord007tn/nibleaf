import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock('@tanstack/react-query', async () => ({ ...(await vi.importActual('@tanstack/react-query')), useQuery: mocks.query }));

import { useDeployments } from './queries';

describe('rollback retry polling', () => {
  it('polls a tracked retryable failure and stops at terminal failure or READY', () => {
    useDeployments('project', { enabled: true, pollIntervalMs: 1500, retryingDeploymentId: 'restore' });
    const options = mocks.query.mock.calls.at(-1)?.[0];
    const interval = (status: string, completedAt: string | null, id = 'restore') =>
      options.refetchInterval({ state: { data: [{ id, status, completedAt }] } });
    expect(interval('FAILED', null)).toBe(1500);
    expect(interval('BUILDING', null)).toBe(1500);
    expect(interval('READY', new Date().toISOString())).toBe(false);
    expect(interval('FAILED', new Date().toISOString())).toBe(false);
    expect(interval('FAILED', null, 'historical-failure')).toBe(false);
  });
});
