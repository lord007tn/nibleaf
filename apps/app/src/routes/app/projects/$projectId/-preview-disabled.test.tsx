// @vitest-environment jsdom
import { act, type ComponentType } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  project: {} as Record<string, unknown>,
  role: 'member',
  membersPending: false,
  membersError: false,
  retry: vi.fn(),
  retryMembers: vi.fn(),
}));
vi.mock('@nibleaf/i18n/react', () => ({ useT: () => (key: string) => key }));
vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (options: Record<string, unknown>) => ({ options, useParams: () => ({ projectId: 'site' }), useSearch: () => ({}) }),
  useNavigate: () => vi.fn(),
  Link: ({ search, children }: { search: { section: string }; children: import('react').ReactNode }) => (
    <a href={`/settings?section=${search.section}`}>{children}</a>
  ),
}));
vi.mock('@/services/auth-client', () => ({ useSession: () => ({ data: { user: { id: 'viewer' } } }) }));
vi.mock('@/hooks/api', () => ({
  useProject: () => state.project,
  useProjectMembers: () => ({
    data: state.membersPending ? undefined : { members: [{ role: state.role, user: { id: 'viewer' } }] },
    isPending: state.membersPending,
    isError: state.membersError,
    refetch: state.retryMembers,
  }),
  useLanguages: () => ({}),
  useBranches: () => ({}),
  usePages: () => ({}),
  usePage: () => ({}),
}));
vi.mock('@/components/markdown', () => ({ Markdown: () => null }));
vi.mock('@/layouts/project', () => ({ PublishControl: () => null }));
vi.mock('@/components/site/documentation-theme-provider', () => ({
  DocumentationProjectPreviewLayout: () => <p data-testid="usable-preview">preview content</p>,
  DocumentationThemeProvider: ({ children }: { children: import('react').ReactNode }) => children,
}));
vi.mock('@/hooks/api/query-options', () => ({ pageQueryOptions: vi.fn() }));
vi.mock('@/hooks/api/route-prefetch', () => ({ defaultScopeId: () => undefined, prefetchScopedPages: vi.fn() }));
vi.mock('@/integrations/tanstack-query/query-client', () => ({ prefetchRouteData: vi.fn() }));

import { Route } from './preview';

const Preview = Route.options.component as unknown as ComponentType;
vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
let root: ReturnType<typeof createRoot>;
beforeEach(() => {
  state.membersPending = false;
  state.membersError = false;
});
afterEach(async () => {
  await act(async () => root?.unmount());
  document.body.replaceChildren();
  vi.clearAllMocks();
});
async function mount() {
  const host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root.render(<Preview />));
  return host;
}
it('announces loading with a skeleton without claiming previews are disabled', async () => {
  state.project = { isPending: true };
  const host = await mount();
  expect(host.querySelector('[aria-busy="true"]')).not.toBeNull();
  expect(host.textContent).not.toContain('preview.disabled');
});
it('offers retry for a failed project request instead of the disabled state', async () => {
  state.project = { isPending: false, isError: true, refetch: state.retry };
  const host = await mount();
  expect(host.querySelector('[role="alert"]')).not.toBeNull();
  expect(host.textContent).not.toContain('preview.disabled');
  await act(async () => host.querySelector('button')?.click());
  expect(state.retry).toHaveBeenCalledOnce();
});
it.each(['owner', 'admin', 'member'])('shows a settings link only for roles allowed to enable previews (%s)', async (role) => {
  state.role = role;
  state.project = { isPending: false, data: { config: { addons: { previewDeployments: false } } } };
  const host = await mount();
  expect(host.textContent).toContain('preview.disabled');
  if (role === 'member') {
    expect(host.querySelector('a')).toBeNull();
    expect(host.textContent).toContain('preview.disabledAskAdmin');
  } else expect(host.querySelector('a')?.getAttribute('href')).toBe('/settings?section=addons');
});

it('does not label a loading Admin as an Editor', async () => {
  state.role = 'admin';
  state.membersPending = true;
  state.project = { data: { config: { addons: { previewDeployments: false } } } };
  const host = await mount();
  expect(host.querySelector('[aria-busy="true"]')).not.toBeNull();
  expect(host.textContent).not.toContain('preview.disabledAskAdmin');
  expect(host.querySelector('a')).toBeNull();
  state.membersPending = false;
  await act(async () => root.render(<Preview />));
  expect(host.querySelector('a')?.getAttribute('href')).toBe('/settings?section=addons');
});
it('shows a retryable permission error instead of an Editor message', async () => {
  state.membersError = true;
  state.project = { data: { config: { addons: { previewDeployments: false } } } };
  const host = await mount();
  expect(host.textContent).not.toContain('preview.disabledAskAdmin');
  expect(host.querySelector('[role="alert"]')).not.toBeNull();
  await act(async () => host.querySelector('button')?.click());
  expect(state.retryMembers).toHaveBeenCalledOnce();
});
it('retains a usable preview when a background project refetch fails', async () => {
  state.project = { data: { config: {} }, isError: true };
  const host = await mount();
  expect(host.querySelector('[data-testid="usable-preview"]')).not.toBeNull();
  expect(host.querySelector('[role="alert"]')).toBeNull();
});
