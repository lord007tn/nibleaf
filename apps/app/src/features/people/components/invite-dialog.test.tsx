// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ invite: vi.fn(), resend: vi.fn() }));
vi.mock('@nibleaf/i18n/react', () => ({
  useT: () => (key: string, vars?: Record<string, unknown>) => (vars ? `${key}(${Object.values(vars).join('|')})` : key),
}));
vi.mock('../api/mutations', () => ({
  useInviteToOrganization: () => ({ mutateAsync: mocks.invite, isPending: false }),
  useResendOrgInvitation: () => ({ mutateAsync: mocks.resend, isPending: false }),
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { InviteDialog } from './invite-dialog';

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
let root: Root;
const flush = async () => {
  for (let i = 0; i < 4; i++) await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
};
async function inviteTwo() {
  const host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  await act(async () =>
    root.render(<InviteDialog onOpenChange={() => undefined} open organizationId="org-1" organizationName="Acme" websites={[]} />),
  );
  const field = document.querySelector('textarea') as HTMLTextAreaElement;
  const setValue = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
  await act(async () => {
    setValue?.call(field, 'ok@example.test, broken@example.test');
    field.dispatchEvent(new Event('input', { bubbles: true }));
  });
  const submit = document.querySelector<HTMLButtonElement>('button[type="submit"]');
  await act(async () => submit?.click());
  await flush();
}
const row = (delivery: string) => document.querySelector<HTMLElement>(`[data-delivery="${delivery}"]`);

beforeEach(() => {
  mocks.resend.mockResolvedValue({ id: 'i-2', expiresAt: '2099-01-01T00:00:00Z', delivery: 'queued' });
});
afterEach(async () => {
  await act(async () => root?.unmount());
  document.body.replaceChildren();
  vi.clearAllMocks();
});

describe('invite result: what happened to each email', () => {
  it('shows a recipient whose email could not be queued, with copy link and retry; never says "sent"', async () => {
    mocks.invite.mockResolvedValue({
      invitations: [
        { id: 'i-1', email: 'ok@example.test', delivery: 'queued' },
        { id: 'i-2', email: 'broken@example.test', delivery: 'failed' },
      ],
      existingMembers: [],
      emailed: false,
    });
    await inviteTwo();
    expect(document.body.textContent).toContain('people.invite.someFailed(1)');
    expect(row('queued')?.textContent).toContain('people.delivery.queued');
    const failed = row('failed');
    expect(failed?.textContent).toContain('broken@example.test');
    expect(failed?.textContent).toContain('people.delivery.failed');
    expect(failed?.textContent).toContain('people.invitations.copyLink');
    const retry = failed?.querySelector<HTMLButtonElement>('button[aria-label="people.invite.retryFor(broken@example.test)"]');
    expect(retry).not.toBeNull();
    await act(async () => retry?.click());
    await flush();
    expect(mocks.resend).toHaveBeenCalledWith('i-2');
    expect(row('failed')).toBeNull();
    expect(document.querySelectorAll('[data-delivery="queued"]')).toHaveLength(2);
    expect(document.body.textContent).toContain('people.invite.emailed');
  });

  it('when every enqueue failed, every recipient is listed as not queued, with its link', async () => {
    mocks.invite.mockResolvedValue({
      invitations: [
        { id: 'i-1', email: 'ok@example.test', delivery: 'failed' },
        { id: 'i-2', email: 'broken@example.test', delivery: 'failed' },
      ],
      existingMembers: [],
      emailed: false,
    });
    await inviteTwo();
    expect(document.body.textContent).toContain('people.invite.someFailed(2)');
    expect(document.querySelectorAll('[data-delivery="failed"]')).toHaveLength(2);
    expect(document.querySelectorAll('[data-delivery="failed"] [data-slot="copy-button"]')).toHaveLength(2);
  });
});
