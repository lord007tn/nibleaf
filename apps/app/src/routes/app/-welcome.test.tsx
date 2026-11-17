// @vitest-environment jsdom
import { act, type ComponentType, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type Callbacks = { onSuccess?: (value: unknown) => unknown; onError?: (error: unknown) => unknown };

const mocks = vi.hoisted(() => ({
  reason: undefined as 'invitation' | 'left' | undefined,
  navigate: vi.fn(),
  invalidateQueries: vi.fn(async () => undefined),
  acceptInvitation: vi.fn(),
  create: vi.fn(),
  remember: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
  landing: null as { slug: string } | null,
  invitations: {} as Record<string, unknown>,
  userName: 'Raed Bahri' as string | undefined,
}));

vi.mock('@nibleaf/i18n/react', () => ({
  useT: () => (key: string, vars?: Record<string, string>) => (vars ? `${key}(${Object.values(vars).join('|')})` : key),
}));
vi.mock('@nibleaf/i18n/locale-state', () => ({ getLocale: () => 'en', renderedLocale: () => 'en', subscribeLanguage: () => () => undefined }));
vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (options: Record<string, unknown>) => ({ options, useSearch: () => ({ reason: mocks.reason }) }),
  useNavigate: () => mocks.navigate,
  Link: ({ children, to, className }: { children: ReactNode; to: string; className?: string }) => (
    <a className={className} href={to}>
      {children}
    </a>
  ),
}));
vi.mock('@tanstack/react-query', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tanstack/react-query')>()),
  useQueryClient: () => ({ invalidateQueries: mocks.invalidateQueries }),
}));
vi.mock('sonner', () => ({ toast: { success: mocks.toastSuccess, error: mocks.toastError } }));
vi.mock('@/components/app/org-switcher/switcher-panel', () => ({
  ORG_ROLE_LABEL: { owner: 'roles.owner', admin: 'roles.admin', member: 'roles.organizationMember' },
}));
vi.mock('@/hooks/api', () => ({
  acceptInvitation: mocks.acceptInvitation,
  useCreateOrganization: () => ({ mutate: mocks.create, isPending: false }),
  useMyInvitations: () => mocks.invitations,
  useSwitcher: () => ({ data: { organizations: [], recent: [], landing: mocks.landing } }),
}));
vi.mock('@/services/auth-client', () => ({ useSession: () => ({ data: { user: { id: 'u-1', name: mocks.userName } } }) }));
vi.mock('@/stores/active-project', () => ({ rememberActiveProject: mocks.remember }));

import { Route } from './welcome';

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
const WelcomePage = Route.options.component as unknown as ComponentType;
let root: ReturnType<typeof createRoot>;

const invitation = (id: string, name: string, orgRole: 'owner' | 'admin' | 'member' = 'member') => ({
  id,
  organization: { name, logo: null },
  inviter: { name: 'Sara' },
  orgRole,
  grants: [{ projectName: 'Developer docs', role: 'viewer' }],
  expiresAt: new Date(Date.now() + 3 * 86_400_000).toISOString(),
});

beforeEach(() => {
  mocks.reason = undefined;
  mocks.landing = null;
  mocks.userName = 'Raed Bahri';
  mocks.invitations = { isPending: false, isError: false, data: [] };
});
afterEach(async () => {
  await act(async () => root?.unmount());
  document.body.replaceChildren();
  vi.clearAllMocks();
});

async function render() {
  const host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root.render(<WelcomePage />));
  return host;
}
const nameInput = (host: HTMLElement) => host.querySelector<HTMLInputElement>('#welcome-create ~ form input') as HTMLInputElement;
const button = (host: HTMLElement, text: string) =>
  [...host.querySelectorAll<HTMLButtonElement>('button')].find((node) => node.textContent?.trim() === text) as HTMLButtonElement;
const flush = () => act(async () => new Promise((resolve) => setTimeout(resolve, 0)));

describe('/app/welcome', () => {
  it.each([
    [undefined, 'welcome.create.title', 'welcome.create.body'],
    ['invitation', 'welcome.noAccess.title', 'welcome.noAccess.body'],
    ['left', 'welcome.left.title', 'welcome.left.body'],
  ] as const)('reason=%s has its own wording', async (reason, title, body) => {
    mocks.reason = reason;
    const host = await render();
    expect(host.querySelector('h1')?.textContent).toBe(title);
    expect(host.querySelector('header p')?.textContent).toBe(body);
    expect(mocks.navigate).not.toHaveBeenCalled();
  });

  it('redirects to the landing org when the person belongs to one', async () => {
    mocks.landing = { slug: 'acme' };
    await render();
    expect(mocks.navigate).toHaveBeenCalledWith({ to: '/app/o/$orgSlug/websites', params: { orgSlug: 'acme' }, replace: true });
  });

  it('prefills the organization name from the first name and creates it', async () => {
    mocks.create.mockImplementation((_input: unknown, callbacks: Callbacks) => callbacks.onSuccess?.({ id: 'org-1', slug: 'raed', name: 'Raed' }));
    const host = await render();
    expect(nameInput(host).value).toBe('welcome.create.defaultName(Raed)');
    await act(async () => button(host, 'organization.create.submit').click());
    expect(mocks.create).toHaveBeenCalledWith({ name: 'welcome.create.defaultName(Raed)' }, expect.anything());
    expect(mocks.navigate).toHaveBeenCalledWith({ to: '/app/o/$orgSlug/websites', params: { orgSlug: 'raed' } });
  });

  it('uses the anonymous default without a name, and cannot submit a blank name', async () => {
    mocks.userName = undefined;
    const host = await render();
    const input = nameInput(host);
    expect(input.value).toBe('welcome.create.defaultNameAnonymous');
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, '   ');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(button(host, 'organization.create.submit').disabled).toBe(true);
    expect(host.textContent).toContain('organization.settings.nameRequired');
  });

  it('lists pending invitations with org role, inviter and website grants', async () => {
    mocks.invitations = { isPending: false, isError: false, data: [invitation('inv-1', 'Acme Docs', 'admin'), invitation('inv-2', 'JOODPMS')] };
    const host = await render();
    const cards = [...host.querySelectorAll('section[aria-labelledby="welcome-invitations"] li')];
    expect(cards).toHaveLength(2);
    expect(cards[0]?.textContent).toContain('Acme Docs');
    expect(cards[0]?.textContent).toContain('roles.admin');
    expect(cards[0]?.textContent).toContain('welcome.invitations.from(Sara)');
    expect(cards[0]?.textContent).toContain('Developer docs (roles.viewer)');
    expect(cards[1]?.textContent).toContain('roles.organizationMember');
  });

  it('Accept joins the org and lands on its Websites', async () => {
    mocks.invitations = { isPending: false, isError: false, data: [invitation('inv-1', 'Acme Docs')] };
    mocks.acceptInvitation.mockResolvedValue({ landing: { organization: 'acme' } });
    const host = await render();
    await act(async () => button(host, 'welcome.invitations.accept').click());
    await flush();
    expect(mocks.acceptInvitation).toHaveBeenCalledWith('inv-1');
    expect(mocks.toastSuccess).toHaveBeenCalledWith('auth.invite.acceptedToast');
    expect(mocks.invalidateQueries).toHaveBeenCalledWith({ queryKey: ['me', 'switcher'] });
    expect(mocks.navigate).toHaveBeenCalledWith({ to: '/app/o/$orgSlug/websites', params: { orgSlug: 'acme' } });
  });

  it('Accept of a website invitation opens that website', async () => {
    mocks.invitations = { isPending: false, isError: false, data: [invitation('inv-1', 'Acme Docs')] };
    mocks.acceptInvitation.mockResolvedValue({ landing: { organization: 'acme', projectId: 'p-9' } });
    const host = await render();
    await act(async () => button(host, 'welcome.invitations.accept').click());
    await flush();
    expect(mocks.remember).toHaveBeenCalledWith('p-9');
    expect(mocks.navigate).toHaveBeenCalledWith({ to: '/app/projects/$projectId', params: { projectId: 'p-9' } });
  });

  it('a failed Accept shows an error and stays', async () => {
    mocks.invitations = { isPending: false, isError: false, data: [invitation('inv-1', 'Acme Docs')] };
    mocks.acceptInvitation.mockRejectedValue(new Error('expired'));
    const host = await render();
    await act(async () => button(host, 'welcome.invitations.accept').click());
    await flush();
    expect(mocks.toastError).toHaveBeenCalledWith('auth.invite.error');
    expect(mocks.navigate).not.toHaveBeenCalled();
  });

  it('shows a skeleton while invitations load', async () => {
    mocks.invitations = { isPending: true };
    const host = await render();
    expect(host.querySelector('[aria-busy="true"]')).not.toBeNull();
  });
});
