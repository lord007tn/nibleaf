// @vitest-environment jsdom

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ session: undefined as unknown, members: undefined as unknown }));
vi.mock('@/services/auth-client', () => ({ useSession: () => state.session }));
vi.mock('@/hooks/api', () => ({ useProjectMembers: () => state.members }));

import { type SiteAdminState, useSiteAdminState } from './use-site-admin-state';

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);

const signedIn = { data: { user: { id: 'user-1' } }, isPending: false };
const team = (role: string) => ({ data: { members: [{ user: { id: 'user-1' }, role }] } });

const read = async (): Promise<SiteAdminState | undefined> => {
  let result: SiteAdminState | undefined;
  const Probe = () => {
    result = useSiteAdminState('site-1');
    return null;
  };
  const container = document.createElement('div');
  const root = createRoot(container);
  await act(async () => root.render(<Probe />));
  await act(async () => root.unmount());
  return result;
};

describe('useSiteAdminState', () => {
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
    expect(await read()).toBe(expected);
  });

  it('is notAdmin for someone signed in but not on the team', async () => {
    Object.assign(state, { session: signedIn, members: { data: { members: [] } } });
    expect(await read()).toBe('notAdmin');
  });

  it.each([
    ['the session is loading', { data: undefined, isPending: true }, team('admin')],
    ['the team is loading', signedIn, { data: undefined }],
    ['the team failed to load', signedIn, { data: undefined, isError: true }],
  ])('is pending, never notAdmin, while %s', async (_label, session, members) => {
    Object.assign(state, { session, members });
    expect(await read()).toBe('pending');
  });
});
