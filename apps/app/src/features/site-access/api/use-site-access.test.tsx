// @vitest-environment jsdom

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ session: undefined as unknown, members: undefined as unknown, query: vi.fn() }));
vi.mock('@/services/auth-client', () => ({ useSession: () => state.session }));
vi.mock('@/hooks/api', () => ({
  useProjectMembers: (projectId: string | undefined) => {
    state.query(projectId);
    return state.members;
  },
}));

import type { SiteAccess } from '../model/access';
import { useSiteAccess } from './use-site-access';

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
const refetch = vi.fn();
const data = { members: [{ user: { id: 'me' }, role: 'admin', orgRole: 'member', viaOrganization: false }] };

async function read(projectId: string | undefined) {
  let result: SiteAccess | undefined;
  function Probe() {
    result = useSiteAccess(projectId);
    return null;
  }
  const root = createRoot(document.createElement('div'));
  await act(async () => root.render(<Probe />));
  await act(async () => root.unmount());
  return result;
}

describe('useSiteAccess', () => {
  afterEach(() => vi.clearAllMocks());

  it.each([
    { name: 'loaded', projectId: 'site', data, sessionId: 'me', pending: false, failed: false, status: 'ready' },
    { name: 'stale cache', projectId: 'site', data, sessionId: 'me', pending: false, failed: true, status: 'ready' },
    { name: 'no member', projectId: 'site', data, sessionId: 'other', pending: false, failed: false, status: 'notMember' },
    { name: 'empty team', projectId: 'site', data: { members: [] }, sessionId: 'me', pending: false, failed: false, status: 'notMember' },
    { name: 'pending', projectId: 'site', data: undefined, sessionId: 'me', pending: true, failed: false, status: 'loading' },
    { name: 'no session', projectId: 'site', data, sessionId: undefined, pending: false, failed: false, status: 'loading' },
    { name: 'no project', projectId: undefined, data, sessionId: 'me', pending: false, failed: false, status: 'loading' },
    { name: 'failed uncached', projectId: 'site', data: undefined, sessionId: 'me', pending: false, failed: true, status: 'unavailable' },
  ])('$name', async ({ projectId, data, sessionId, pending, failed, status }) => {
    state.session = { data: sessionId ? { user: { id: sessionId } } : null, isPending: false };
    state.members = { data, isPending: pending, isError: failed, isFetching: false, refetch };
    const access = await read(projectId);
    expect(access?.status).toBe(status);
    expect(state.query).toHaveBeenCalledExactlyOnceWith(projectId);
    if (access?.status === 'ready') {
      expect(access).toEqual({ status: 'ready', role: 'admin', orgRole: 'member', stale: failed, retry: refetch });
    }
    if (access?.status === 'unavailable') {
      access.retry();
      expect(refetch).toHaveBeenCalledOnce();
    }
  });
});
