// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ removeMember: vi.fn(), patchRole: vi.fn(), revoke: vi.fn() }));
vi.mock('@/services/api', () => ({
  api: {
    app: {
      organizations: {
        ':organizationId': {
          members: { ':memberId': { $delete: mocks.removeMember } },
          invitations: { ':id': { $delete: mocks.revoke } },
        },
      },
      projects: { ':projectId': { members: { ':id': { role: { $patch: mocks.patchRole } } } } },
    },
  },
}));

import { useChangeSiteRole, useRemoveOrgMember, useRevokeOrgInvitation } from './mutations';

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
let root: Root;
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const deferred = () => {
  let resolve: (value: Response) => void = () => undefined;
  const promise = new Promise<Response>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};

/** Mounts a hook and returns its latest value. */
async function mountHook<T>(client: QueryClient, useHook: () => T) {
  const result: { current: T | null } = { current: null };
  function Probe() {
    result.current = useHook();
    return null;
  }
  const host = document.createElement('div');
  root = createRoot(host);
  await act(async () =>
    root.render(
      <QueryClientProvider client={client}>
        <Probe />
      </QueryClientProvider>,
    ),
  );
  return result as { current: T };
}
afterEach(async () => {
  await act(async () => root?.unmount());
  vi.clearAllMocks();
});

const members = [
  { id: 'm-1', userId: 'u-1', orgRole: 'member', user: { id: 'u-1', name: 'Lina', email: 'l@example.test', image: null }, projectGrants: [] },
  { id: 'm-2', userId: 'u-2', orgRole: 'member', user: { id: 'u-2', name: 'Ziad', email: 'z@example.test', image: null }, projectGrants: [] },
];

describe('people mutations (optimistic class)', () => {
  it('removes a member at once and puts them back when the server refuses', async () => {
    const client = new QueryClient();
    client.setQueryData(['organizations', 'org-1', 'members'], members);
    const response = deferred();
    mocks.removeMember.mockReturnValue(response.promise);
    const hook = await mountHook(client, () => useRemoveOrgMember('org-1'));
    let settled: Promise<unknown> = Promise.resolve();
    await act(async () => {
      settled = hook.current.mutateAsync('m-1').catch((error: unknown) => error);
    });
    expect((client.getQueryData(['organizations', 'org-1', 'members']) as typeof members).map((m) => m.id)).toEqual(['m-2']);
    await act(async () => {
      response.resolve(json(403, { error: { code: 'auth:insufficient_role', message: 'no' } }));
      await settled;
    });
    expect((client.getQueryData(['organizations', 'org-1', 'members']) as typeof members).map((m) => m.id)).toEqual(['m-1', 'm-2']);
  });

  it('a revoke refused as already accepted comes back with its reason', async () => {
    const client = new QueryClient();
    client.setQueryData(['organizations', 'org-1', 'invitations'], [{ id: 'i-1', email: 'a@example.test' }]);
    mocks.revoke.mockResolvedValue(
      json(409, { error: { code: 'database:conflict', message: 'accepted', details: { reason: 'invitation_accepted' } } }),
    );
    const hook = await mountHook(client, () => useRevokeOrgInvitation('org-1'));
    let error: unknown;
    await act(async () => {
      error = await hook.current.mutateAsync('i-1').catch((cause: unknown) => cause);
    });
    expect(error).toMatchObject({ status: 409, reason: 'invitation_accepted' });
    expect(client.getQueryData(['organizations', 'org-1', 'invitations'])).toEqual([{ id: 'i-1', email: 'a@example.test' }]);
  });

  it('shows a new website role at once and restores the old one on failure', async () => {
    const client = new QueryClient();
    const team = { members: [{ id: 'm-1', role: 'viewer' }], invitations: [] };
    client.setQueryData(['members', 'site-1'], team);
    const response = deferred();
    mocks.patchRole.mockReturnValue(response.promise);
    const hook = await mountHook(client, () => useChangeSiteRole('site-1'));
    let settled: Promise<unknown> = Promise.resolve();
    await act(async () => {
      settled = hook.current.mutateAsync({ memberId: 'm-1', role: 'admin' }).catch((error: unknown) => error);
    });
    expect((client.getQueryData(['members', 'site-1']) as typeof team).members[0]?.role).toBe('admin');
    await act(async () => {
      response.resolve(json(403, { error: { code: 'auth:insufficient_role', message: 'no' } }));
      await settled;
    });
    expect((client.getQueryData(['members', 'site-1']) as typeof team).members[0]?.role).toBe('viewer');
  });
});
