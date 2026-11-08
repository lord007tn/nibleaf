// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { AnchorHTMLAttributes, ComponentType, ReactNode } from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiResponseError } from '@/hooks/api/client-helpers';
import { readPendingDestination, setPendingDestination } from '@/lib/invitations';
import { rememberActiveProject } from '@/stores/active-project';

const TOKEN = `nlj_${'a'.repeat(43)}`;

const mocks = vi.hoisted(() => ({
  session: vi.fn(),
  preview: vi.fn(),
  meta: vi.fn(),
  join: vi.fn(),
  navigate: vi.fn(),
  toastSuccess: vi.fn(),
  projects: vi.fn(),
}));

vi.mock('@nibleaf/i18n/react', () => ({
  useT: () => (key: string, variables?: Record<string, string>) => (variables ? `${key}:${Object.values(variables).join('|')}` : key),
}));
vi.mock('@/hooks/api', () => ({ useJoinWithLink: () => ({ mutate: mocks.join, isPending: false }) }));
vi.mock('@/hooks/api/query-options', () => ({
  joinLinkPreviewQueryOptions: (token: string) => ({ queryKey: ['public', 'join', token], queryFn: mocks.preview, retry: false }),
  getPublicMetaQueryOptions: () => ({ queryKey: ['public', 'meta'], queryFn: mocks.meta }),
  projectsQueryOptions: () => ({ queryKey: ['projects'], queryFn: mocks.projects }),
}));
vi.mock('@/integrations/tanstack-query/query-client', () => ({ prefetchRouteData: vi.fn() }));
vi.mock('@/integrations/tanstack-query/session-cache', () => ({ syncDashboardSession: vi.fn() }));
vi.mock('@/stores/active-project', () => ({ rememberActiveProject: vi.fn() }));
vi.mock('@/services/auth-client', () => ({ useSession: mocks.session }));
vi.mock('@/services/dashboard-session', () => ({ signOutDashboard: vi.fn() }));
vi.mock('sonner', () => ({ toast: { success: mocks.toastSuccess } }));
vi.mock('@/components/auth-providers', () => ({ AuthProviders: ({ children }: { children: ReactNode }) => children }));
vi.mock('@/layouts/auth', () => ({
  AuthLayout: ({ children, subtitle }: { children: ReactNode; subtitle?: string }) => (
    <main>
      <h1>{subtitle}</h1>
      {children}
    </main>
  ),
}));
vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (options: { component: ComponentType }) => ({ options, useParams: () => ({ token: TOKEN }) }),
  useNavigate: () => mocks.navigate,
  Link: ({ to, children, onClick, ...props }: AnchorHTMLAttributes<HTMLAnchorElement> & { to: string }) => (
    <a
      href={to}
      {...props}
      onClick={(event) => {
        onClick?.(event);
        event.preventDefault();
      }}
    >
      {children}
    </a>
  ),
}));

import { Route } from './join.$token';

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
const PageComponent = Route.options.component as ComponentType;
const preview = { siteName: 'Acme Docs', role: 'viewer', allowedDomain: null as string | null };

describe('join page', () => {
  let container: HTMLDivElement;
  let root: Root;
  let queryClient: QueryClient;

  const render = async () => {
    await act(async () =>
      root.render(
        <QueryClientProvider client={queryClient}>
          <PageComponent />
        </QueryClientProvider>,
      ),
    );
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  };

  beforeEach(() => {
    queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    mocks.preview.mockResolvedValue(preview);
    mocks.meta.mockResolvedValue({ signupDisabled: false });
    mocks.projects.mockResolvedValue([]);
    mocks.navigate.mockResolvedValue(undefined);
    mocks.session.mockReturnValue({ data: null, isPending: false });
    window.localStorage.clear();
    // biome-ignore lint/suspicious/noDocumentCookie: resetting the test document's cookie.
    document.cookie = 'nibleaf_join=; Path=/; Max-Age=0';
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.clearAllMocks();
  });

  it('names the site and role, and remembers the link for a signed-out visitor', async () => {
    await render();
    expect(container.textContent).toContain('join.title:Acme Docs');
    expect(container.textContent).toContain('join.offer:roles.viewer');
    expect(readPendingDestination()).toBe(`/join/${TOKEN}`);
    expect(document.cookie).toContain(`nibleaf_join=${TOKEN}`);
    const hrefs = [...container.querySelectorAll('a')].map((link) => link.getAttribute('href'));
    expect(hrefs).toEqual(expect.arrayContaining(['/sign-up', '/sign-in']));
  });

  it('offers only sign-in when sign-up is disabled on the server', async () => {
    mocks.meta.mockResolvedValue({ signupDisabled: true });
    await render();
    expect(container.textContent).toContain('join.signupDisabled');
    const hrefs = [...container.querySelectorAll('a')].map((link) => link.getAttribute('href'));
    expect(hrefs).not.toContain('/sign-up');
    expect(hrefs).toContain('/sign-in');
  });

  it('shows one plain message for a link that does not work, and forgets it', async () => {
    setPendingDestination(`/join/${TOKEN}`);
    mocks.preview.mockRejectedValue(new ApiResponseError('This join link is not valid.', 404, 'join:invalid'));
    await render();
    expect(container.textContent).toContain('join.invalid');
    expect(readPendingDestination()).toBeNull();
  });

  it('joins a signed-in person and opens the site', async () => {
    mocks.session.mockReturnValue({ data: { user: { id: 'u1', email: 'ada@acme.com' } }, isPending: false });
    setPendingDestination(`/join/${TOKEN}`);
    await render();
    const join = [...container.querySelectorAll('button')].find((item) => item.textContent?.startsWith('join.joinButton'));
    await act(async () => join?.click());
    expect(mocks.join).toHaveBeenCalledWith(TOKEN, expect.anything());
    const [, options] = mocks.join.mock.calls[0] as [string, { onSuccess: (result: unknown) => void }];
    await act(async () => {
      options.onSuccess({ status: 'joined', projectId: 'site-9', role: 'viewer' });
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(mocks.toastSuccess).toHaveBeenCalledWith('join.joinedToast:Acme Docs');
    expect(rememberActiveProject).toHaveBeenCalledWith('site-9');
    expect(mocks.navigate).toHaveBeenCalledWith({ to: '/app/projects/$projectId', params: { projectId: 'site-9' } });
    expect(readPendingDestination()).toBeNull();
  });

  it('says "already a member" instead of an error', async () => {
    mocks.session.mockReturnValue({ data: { user: { id: 'u1', email: 'ada@acme.com' } }, isPending: false });
    await render();
    const join = [...container.querySelectorAll('button')].find((item) => item.textContent?.startsWith('join.joinButton'));
    await act(async () => join?.click());
    const [, options] = mocks.join.mock.calls[0] as [string, { onSuccess: (result: unknown) => void }];
    await act(async () => {
      options.onSuccess({ status: 'already_member', projectId: 'site-9', role: 'admin' });
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(mocks.toastSuccess).toHaveBeenCalledWith('join.alreadyMemberToast:Acme Docs');
  });

  it('explains a domain mismatch and offers another account', async () => {
    mocks.preview.mockResolvedValue({ ...preview, allowedDomain: 'acme.com' });
    mocks.session.mockReturnValue({ data: { user: { id: 'u1', email: 'ada@other.io' } }, isPending: false });
    await render();
    expect(container.textContent).toContain('join.domainOnly:acme.com');
    const join = [...container.querySelectorAll('button')].find((item) => item.textContent?.startsWith('join.joinButton'));
    await act(async () => join?.click());
    const [, options] = mocks.join.mock.calls[0] as [string, { onError: (error: unknown) => void }];
    await act(async () => options.onError(new ApiResponseError('nope', 403, 'join:domain_not_allowed')));
    expect(container.textContent).toContain('join.wrongDomain:acme.com|ada@other.io');
    expect([...container.querySelectorAll('button')].some((item) => item.textContent === 'join.useAnotherAccount')).toBe(true);
  });

  it('switches to the invalid state when a refetch finds the link gone', async () => {
    mocks.session.mockReturnValue({ data: { user: { id: 'u1', email: 'ada@acme.com' } }, isPending: false });
    await render();
    expect(container.textContent).toContain('join.joinButton');
    // The link was disabled while the page was open: joining says so, and the refetch 404s.
    mocks.preview.mockRejectedValue(new ApiResponseError('This join link is not valid.', 404, 'join:invalid'));
    const join = [...container.querySelectorAll('button')].find((item) => item.textContent?.startsWith('join.joinButton'));
    await act(async () => join?.click());
    const [, options] = mocks.join.mock.calls[0] as [string, { onError: (error: unknown) => void }];
    await act(async () => {
      options.onError(new ApiResponseError('This join link is not valid.', 404, 'join:invalid'));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(container.textContent).toContain('join.invalid');
    expect(container.textContent).not.toContain('join.joinButton');
  });
});
