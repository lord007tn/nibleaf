// @vitest-environment jsdom

import { act, type ComponentType } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  useMembers: vi.fn(),
  invite: { mutate: vi.fn(), isPending: false },
  remove: { mutate: vi.fn(), isPending: false, variables: undefined as string | undefined },
  prefetchRouteData: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock('@nibleaf/i18n/react', () => ({ useT: () => (key: string) => key }));
vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (options: Record<string, unknown>) => ({ options }),
}));
vi.mock('@nibleaf/design-system/components/ui/confirm', () => ({ useConfirm: () => async () => true }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: mocks.toastError } }));
vi.mock('@/hooks/api/query-options', () => ({ membersQueryOptions: () => ({ queryKey: ['members'] }) }));
vi.mock('@/integrations/tanstack-query/query-client', () => ({ prefetchRouteData: mocks.prefetchRouteData }));
vi.mock('@/hooks/api', async () => ({
  // The real plain-language mapping, so the test proves server text never reaches the toast.
  friendlyErrorMessage: (await vi.importActual<typeof import('@/hooks/api/errors')>('@/hooks/api/errors')).friendlyErrorMessage,
  useMembers: mocks.useMembers,
  useInviteMember: () => mocks.invite,
  useRemoveMember: () => mocks.remove,
  useUpdateMemberRole: () => ({ mutate: vi.fn(), isPending: false }),
}));

import { Route } from './members';

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
const MembersPage = Route.options.component as unknown as ComponentType;
const loader = (Route.options as unknown as { loader: (args: unknown) => void }).loader;

const members = [
  { id: 'm-owner', role: 'owner', user: { name: 'Owner Person', email: 'owner@example.test' } },
  { id: 'm-1', role: 'member', user: { name: 'Writer One', email: 'one@example.test' } },
  { id: 'm-2', role: 'admin', user: { name: 'Writer Two', email: 'two@example.test' } },
];

describe('workspace members page', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    mocks.useMembers.mockReturnValue({ isPending: false, isError: false, data: { members, invitations: [] }, refetch: vi.fn() });
    mocks.invite.isPending = false;
    mocks.remove.isPending = false;
    mocks.remove.variables = undefined;
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.clearAllMocks();
    vi.restoreAllMocks();
  });

  const render = async () => {
    await act(async () => root.render(<MembersPage />));
  };

  it('prefetches the member list in the route loader', () => {
    const queryClient = {};
    loader({ context: { queryClient } });
    expect(mocks.prefetchRouteData).toHaveBeenCalledExactlyOnceWith(queryClient, { queryKey: ['members'] });
  });

  it('shows a busy, row-shaped skeleton (not member rows) on first load', async () => {
    mocks.useMembers.mockReturnValue({ isPending: true, isError: false, data: undefined, refetch: vi.fn() });
    await render();

    expect(container.querySelector('[aria-busy="true"]')).not.toBeNull();
    expect(container.querySelector('[role="status"]')?.textContent).toBe('common.loading');
    expect(container.querySelectorAll('[data-slot="skeleton"]').length).toBeGreaterThan(0);
    expect(container.textContent).not.toContain('Writer One');
  });

  it('offers a retry instead of an empty table when the list fails to load', async () => {
    const refetch = vi.fn();
    mocks.useMembers.mockReturnValue({ isPending: false, isError: true, data: undefined, refetch });
    await render();

    const alert = container.querySelector('[role="alert"]');
    expect(alert).not.toBeNull();
    expect(container.querySelector('table')).toBeNull();
    await act(async () => alert?.querySelector<HTMLButtonElement>('button')?.click());
    expect(refetch).toHaveBeenCalledOnce();
  });

  it('spins only the remove button of the member being removed', async () => {
    mocks.remove.isPending = true;
    mocks.remove.variables = 'm-1';
    await render();

    const removeButtons = [...container.querySelectorAll<HTMLButtonElement>('button[aria-label="members.remove"]')];
    expect(removeButtons).toHaveLength(2);
    expect(removeButtons.map((button) => button.getAttribute('aria-busy'))).toEqual(['true', null]);
    expect(removeButtons[1]?.disabled).toBe(false);
  });

  it('shows the invite button busy while the invitation is sent', async () => {
    mocks.invite.isPending = true;
    await render();

    const invite = container.querySelector<HTMLButtonElement>('button[type="submit"]');
    expect(invite?.getAttribute('aria-busy')).toBe('true');
    expect(invite?.disabled).toBe(true);
  });

  it('reports a failed invite in plain words, never the server text', async () => {
    mocks.invite.mutate.mockImplementation((_body: unknown, options: { onError: (error: Error) => void }) =>
      options.onError(new Error('P2002 Unique constraint failed on the fields: (`email`)')),
    );
    await render();

    const email = container.querySelector<HTMLInputElement>('#workspace-member-email');
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(email, 'new@example.test');
      email?.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => container.querySelector('form')?.requestSubmit());

    expect(mocks.invite.mutate).toHaveBeenCalledOnce();
    expect(mocks.toastError).toHaveBeenCalledExactlyOnceWith('members.toast.inviteError');
  });

  it('says the person is already a member when the server answers 409, not that someone else changed it', async () => {
    const { ApiResponseError } = await vi.importActual<typeof import('@/hooks/api/client-helpers')>('@/hooks/api/client-helpers');
    mocks.invite.mutate.mockImplementation((_body: unknown, options: { onError: (error: Error) => void }) =>
      options.onError(new ApiResponseError('That person is already a member of this workspace.', 409)),
    );
    await render();

    const email = container.querySelector<HTMLInputElement>('#workspace-member-email');
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(email, 'one@example.test');
      email?.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => container.querySelector('form')?.requestSubmit());

    expect(mocks.toastError).toHaveBeenCalledExactlyOnceWith('members.toast.alreadyMember');
  });
});
