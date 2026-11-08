// @vitest-environment jsdom

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ session: undefined as unknown, members: undefined as unknown }));
vi.mock('@/services/auth-client', () => ({ useSession: () => state.session }));
vi.mock('@/hooks/api', () => ({ useProjectMembers: () => state.members }));

import { useProjectAdminStatus } from './use-project-admin-status';

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);

type AdminStatus = ReturnType<typeof useProjectAdminStatus>;

const refetch = vi.fn();
const signedIn = { data: { user: { id: 'user-1' } }, isPending: false };
const loaded = (members: { user: { id: string }; role: string }[], extra: Record<string, unknown> = {}) => ({
  data: { members },
  isPending: false,
  isError: false,
  isFetching: false,
  refetch,
  ...extra,
});
const team = (role: string) => loaded([{ user: { id: 'user-1' }, role }]);
const loading = { data: undefined, isPending: true, isError: false, isFetching: true, refetch };
const failed = { data: undefined, isPending: false, isError: true, isFetching: false, refetch };

const read = async (projectId: string | undefined): Promise<AdminStatus | undefined> => {
  let result: AdminStatus | undefined;
  const Probe = () => {
    result = useProjectAdminStatus(projectId);
    return null;
  };
  const container = document.createElement('div');
  const root = createRoot(container);
  await act(async () => root.render(<Probe />));
  await act(async () => root.unmount());
  return result;
};

describe('useProjectAdminStatus', () => {
  afterEach(() => {
    state.session = undefined;
    state.members = undefined;
  });

  it.each([
    ['owner', 'admin'],
    ['admin', 'admin'],
    ['member', 'notAdmin'],
  ])('a %s is %s', async (role, expected) => {
    Object.assign(state, { session: signedIn, members: team(role) });
    expect((await read('site-1'))?.status).toBe(expected);
  });

  // The server only lets members of the site's own team at or above Admin
  // administer it, so someone missing from the loaded team is a settled "no",
  // never a loading state that never ends.
  it('is notAdmin, not pending, for someone signed in but missing from the loaded team', async () => {
    Object.assign(state, { session: signedIn, members: loaded([{ user: { id: 'someone-else' }, role: 'owner' }]) });
    const result = await read('site-1');
    expect(result?.status).toBe('notAdmin');
    expect(result?.isError).toBe(false);
  });

  it('is notAdmin for an empty loaded team', async () => {
    Object.assign(state, { session: signedIn, members: loaded([]) });
    expect((await read('site-1'))?.status).toBe('notAdmin');
  });

  it.each([
    ['the session is loading', { data: undefined, isPending: true }, team('admin')],
    ['nobody is signed in yet', { data: null, isPending: false }, team('admin')],
    ['the team is loading', signedIn, loading],
  ])('is pending, never notAdmin, while %s', async (_label, session, members) => {
    Object.assign(state, { session, members });
    const result = await read('site-1');
    expect(result?.status).toBe('pending');
    expect(result?.isError).toBe(false);
  });

  it('is pending with isError when the team failed to load and nothing is cached, and retries the members query', async () => {
    Object.assign(state, { session: signedIn, members: failed });
    const result = await read('site-1');
    expect(result?.status).toBe('pending');
    expect(result?.isError).toBe(true);
    result?.retry();
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['admin', 'admin'],
    ['member', 'notAdmin'],
  ])('keeps the cached %s membership (%s) when a background refetch fails', async (role, expected) => {
    Object.assign(state, {
      session: signedIn,
      members: loaded([{ user: { id: 'user-1' }, role }], { isError: true, isFetching: false }),
    });
    const result = await read('site-1');
    expect(result?.status).toBe(expected);
    expect(result?.isError).toBe(false);
  });

  it('reports retrying while the members query refetches', async () => {
    Object.assign(state, { session: signedIn, members: team('admin') });
    state.members = { ...(state.members as object), isFetching: true };
    expect((await read('site-1'))?.retrying).toBe(true);
  });

  it('is pending without a site, even with an admin membership cached', async () => {
    // Only the missing-site guard can make this pending: the session is signed in
    // and the cached team says Admin.
    Object.assign(state, { session: signedIn, members: team('admin') });
    expect((await read(undefined))?.status).toBe('pending');
  });

  it.each([
    ['owner', 'edit'],
    ['admin', 'edit'],
    ['member', 'edit'],
    ['viewer', 'viewOnly'],
  ])('a %s may %s content', async (role, expected) => {
    Object.assign(state, { session: signedIn, members: team(role) });
    const result = await read('site-1');
    expect(result?.edit).toBe(expected);
    expect(result?.role).toBe(role);
  });

  it('a Viewer is never offered administration', async () => {
    Object.assign(state, { session: signedIn, members: team('viewer') });
    expect((await read('site-1'))?.status).toBe('notAdmin');
  });

  it('keeps content locked but unexplained while the team loads', async () => {
    Object.assign(state, { session: signedIn, members: loading });
    expect((await read('site-1'))?.edit).toBe('pending');
  });

  // The server enforces every write, so a failed team read must not lock a
  // real Editor out of their work.
  it('falls back to edit when the team failed to load', async () => {
    Object.assign(state, { session: signedIn, members: failed });
    expect((await read('site-1'))?.edit).toBe('edit');
  });

  it('is view-only for someone signed in but missing from the loaded team', async () => {
    Object.assign(state, { session: signedIn, members: loaded([]) });
    expect((await read('site-1'))?.edit).toBe('viewOnly');
  });
});
