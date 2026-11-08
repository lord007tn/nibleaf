// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  links: [] as unknown[],
  create: vi.fn(),
  regenerate: vi.fn(),
  revoke: vi.fn(),
  confirm: vi.fn(async () => true),
}));

vi.mock('@nibleaf/i18n/react', () => ({
  useT: () => (key: string, variables?: Record<string, string | number>) =>
    variables
      ? `${key}(${Object.entries(variables)
          .map(([name, value]) => `${name}=${value}`)
          .join(',')})`
      : key,
  useLocale: () => ({ locale: 'en' }),
}));
vi.mock('@nibleaf/design-system/components/ui/confirm', () => ({ useConfirm: () => state.confirm }));
vi.mock('@/components/members/role-select', () => ({ RoleSelect: () => <span data-testid="role-select" /> }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@/hooks/api', () => ({
  friendlyErrorMessage: (_t: unknown, _e: unknown, key: string) => key,
  useJoinLinks: () => ({ data: state.links, isPending: false, isError: false }),
  useCreateJoinLink: () => ({ mutate: state.create, isPending: false }),
  useRegenerateJoinLink: () => ({ mutate: state.regenerate, isPending: false }),
  useRevokeJoinLink: () => ({ mutate: state.revoke, isPending: false }),
}));

import { JoinLinksSection } from './join-links-section';

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);

const link = (overrides: Record<string, unknown> = {}) => ({
  id: 'link-1',
  label: 'Support',
  role: 'viewer',
  allowedDomain: 'acme.com',
  maxUses: 5,
  useCount: 2,
  expiresAt: '2026-12-01T00:00:00Z',
  revokedAt: null,
  createdAt: '2026-11-01T00:00:00Z',
  createdBy: { id: 'u1', name: 'Ada', email: 'ada@acme.com' },
  uses: [
    {
      id: 'use-1',
      email: 'grace@acme.com',
      role: 'viewer',
      createdAt: '2026-11-02T00:00:00Z',
      user: { id: 'u2', name: 'Grace', email: 'grace@acme.com' },
    },
  ],
  status: 'active',
  ...overrides,
});

let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
const render = async () => {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root.render(<JoinLinksSection projectId="site-1" />));
};
const button = (text: string) => [...host.querySelectorAll('button')].find((item) => item.textContent?.includes(text));
const type = async (input: HTMLInputElement, value: string) => {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  await act(async () => {
    setter?.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
};

beforeEach(() => {
  state.links = [];
  state.create.mockReset();
  state.regenerate.mockReset();
  state.revoke.mockReset();
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});

describe('JoinLinksSection', () => {
  it('describes each link: role, uses, expiry, domain, status and who joined', async () => {
    state.links = [link()];
    await render();
    const text = host.textContent ?? '';
    expect(text).toContain('Support');
    expect(text).toContain('settings.joinLinks.status.active');
    expect(text).toContain('settings.joinLinks.joinsAs(role=roles.viewer)');
    expect(text).toContain('settings.joinLinks.uses(used=2,max=5)');
    expect(text).toContain('settings.joinLinks.domainOnly(domain=acme.com)');
    await act(async () => button('settings.joinLinks.recentJoins')?.click());
    expect(host.textContent).toContain('grace@acme.com');
  });

  it('offers no actions on a disabled link', async () => {
    state.links = [link({ status: 'revoked', revokedAt: '2026-11-03T00:00:00Z' })];
    await render();
    expect(button('settings.joinLinks.regenerate')).toBeUndefined();
    expect(button('settings.joinLinks.disable')).toBeUndefined();
  });

  it('creates a link with the chosen limits and shows it once', async () => {
    await render();
    await act(async () => button('settings.joinLinks.create')?.click());
    const inputs = [...host.querySelectorAll<HTMLInputElement>('[data-testid="join-link-form"] input')];
    await type(inputs[0] as HTMLInputElement, 'Partners');
    await type(host.querySelector<HTMLInputElement>('input[type="number"]') as HTMLInputElement, '3');
    await type(host.querySelector<HTMLInputElement>('input[dir="ltr"]') as HTMLInputElement, '@Acme.com');
    await act(async () => host.querySelector<HTMLFormElement>('[data-testid="join-link-form"]')?.requestSubmit());
    expect(state.create).toHaveBeenCalledWith(
      { label: 'Partners', role: 'member', expiresInDays: 7, maxUses: 3, allowedDomain: 'acme.com' },
      expect.anything(),
    );
    const [, options] = state.create.mock.calls[0] as [unknown, { onSuccess: (result: unknown) => void }];
    await act(async () => options.onSuccess({ link: link(), url: 'https://app.example/join/nlj_secret', token: 'nlj_secret' }));
    expect(host.querySelector<HTMLInputElement>('[data-testid="join-link-fresh"] input')?.value).toBe('https://app.example/join/nlj_secret');
  });

  it('refuses an invalid domain or limit before sending anything', async () => {
    await render();
    await act(async () => button('settings.joinLinks.create')?.click());
    await type(host.querySelector<HTMLInputElement>('input[dir="ltr"]') as HTMLInputElement, 'not a domain');
    expect(host.textContent).toContain('settings.joinLinks.domainInvalid');
    await act(async () => host.querySelector<HTMLFormElement>('[data-testid="join-link-form"]')?.requestSubmit());
    expect(state.create).not.toHaveBeenCalled();
  });

  it('asks before regenerating or disabling', async () => {
    state.links = [link()];
    await render();
    state.confirm.mockResolvedValueOnce(false);
    await act(async () => button('settings.joinLinks.regenerate')?.click());
    expect(state.regenerate).not.toHaveBeenCalled();
    await act(async () => button('settings.joinLinks.disable')?.click());
    expect(state.revoke).toHaveBeenCalledWith('link-1', expect.anything());
  });
});
