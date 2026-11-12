/** @vitest-environment jsdom */

import type { ReactNode } from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

const hooks = vi.hoisted(() => ({
  authorization: vi.fn(),
  create: { mutateAsync: vi.fn() },
}));

vi.mock('@nibleaf/i18n/react', () => ({ useT: () => (key: string) => key }));
vi.mock('@/layouts/auth', () => ({ AuthLayout: ({ children }: { children: ReactNode }) => <main>{children}</main> }));
vi.mock('@/components/query-error-state', () => ({ QueryErrorState: () => <p>error</p> }));
vi.mock('@/services/auth-client', () => ({ useSession: () => ({ data: { user: { id: 'user-1' } }, isPending: false }) }));
vi.mock('@/hooks/api', () => ({ useMcpOAuthAuthorization: hooks.authorization, useCreateMcpOAuthGrant: () => hooks.create }));

import { McpOAuthConsentStep, McpOAuthProjectStep } from './mcp-oauth-steps';

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
const roots: Array<ReturnType<typeof createRoot>> = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await act(async () => root.unmount());
  document.body.replaceChildren();
  window.history.replaceState(null, '', '/');
  vi.restoreAllMocks();
});

describe('OAuth action progress', () => {
  it.each([
    ['project', 'oauth.project.continue', 'oauth.project.cancel', 'oauth.project.error'],
    ['project', 'oauth.project.cancel', 'oauth.project.continue', 'oauth.consent.error'],
    ['consent', 'oauth.consent.allow', 'oauth.consent.deny', 'oauth.consent.error'],
    ['consent', 'oauth.consent.deny', 'oauth.consent.allow', 'oauth.consent.error'],
  ])('shows loading for %s / %s and disables the other action', async (step, action, other, error) => {
    hooks.authorization.mockReturnValue(
      authorization({
        selection: { id: 'g1', preset: 'read_only', scopes: ['mcp:connect', 'pages:read'], project: { id: 'p1', name: 'Docs' } },
      }),
    );
    hooks.create.mutateAsync.mockResolvedValue(undefined);
    let fail!: (error: Error) => void;
    vi.spyOn(globalThis, 'fetch').mockImplementation(
      () =>
        new Promise<Response>((_resolve, reject) => {
          fail = reject;
        }),
    );
    const container = await render(step === 'project' ? <McpOAuthProjectStep /> : <McpOAuthConsentStep />);
    const buttons = [...container.querySelectorAll('button')];
    const clicked = buttons.find((button) => button.textContent?.startsWith(action));
    const alternative = buttons.find((button) => button.textContent?.startsWith(other));
    expect(clicked).toBeDefined();
    expect(alternative).toBeDefined();
    await act(async () => clicked?.click());
    expect(clicked?.getAttribute('aria-busy')).toBe('true');
    expect(clicked?.hasAttribute('data-loading')).toBe(true);
    expect(alternative?.disabled).toBe(true);
    await act(async () => fail(new Error('offline')));
    expect(container.textContent).toContain(error);
    expect(clicked?.hasAttribute('data-loading')).toBe(false);
    expect(alternative?.disabled).toBe(false);
  });
});

const signed = Buffer.from('client_id=c1&ba_param=client_id&sig=abc').toString('base64url');
const site = (id: string, name: string, slug: string, organization: { id: string; name: string }) => ({
  id,
  name,
  slug,
  workspace: organization.name,
  organization,
  role: 'member',
  presets: ['read_only', 'support_writer'],
});
const authorization = (overrides: object = {}) => ({
  isPending: false,
  isError: false,
  data: {
    client: { clientId: 'c1', name: 'Claude', uri: null, redirectTarget: 'claude.ai', verifiedDomain: null },
    requestedScopes: ['mcp:connect', 'pages:read', 'offline_access'],
    projects: [site('p1', 'Docs', 'docs', { id: 'org-acme', name: 'Acme' })],
    selection: null,
    ...overrides,
  },
});

async function render(node: ReactNode) {
  window.history.replaceState(null, '', `/oauth/project?oauth_request=${signed}`);
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  await act(async () => root.render(node));
  return container;
}

describe('MCP OAuth project step', () => {
  it('preselects the only project and keeps Full admin out of a member’s reach', async () => {
    hooks.authorization.mockReturnValue(authorization());
    const container = await render(<McpOAuthProjectStep />);
    const radios = [...container.querySelectorAll<HTMLInputElement>('input[type="radio"]')];
    expect(radios[0]?.checked).toBe(true);
    const fullAdmin = radios.find((radio) => radio.name === 'mcp-oauth-preset' && radio.closest('label')?.textContent?.includes('full_admin'));
    expect(fullAdmin?.disabled).toBe(true);
    expect(container.textContent).toContain('settings.apiKeys.adminOnly');
  });

  it('groups websites under their organization, keeping same-named organizations apart', async () => {
    hooks.authorization.mockReturnValue(
      authorization({
        projects: [
          site('p1', 'Docs', 'docs', { id: 'org-1', name: 'Acme' }),
          site('p2', 'Docs', 'docs-2', { id: 'org-2', name: 'Acme' }),
          site('p3', 'Blog', 'blog', { id: 'org-1', name: 'Acme' }),
        ],
      }),
    );
    const container = await render(<McpOAuthProjectStep />);
    const groups = [...container.querySelectorAll('[data-slot="organization-group"]')];
    expect(groups).toHaveLength(2);
    expect(groups.map((group) => group.getAttribute('role'))).toEqual(['group', 'group']);
    expect(groups[0]?.getAttribute('aria-labelledby')).toBe('mcp-oauth-org-org-1');
    expect([...(groups[0]?.querySelectorAll('label') ?? [])].map((label) => label.textContent)).toEqual(['Docsdocs', 'Blogblog']);
    expect(groups[1]?.textContent).toContain('docs-2');
    // One radio group across organizations: picking one website unpicks the others.
    expect(new Set([...container.querySelectorAll<HTMLInputElement>('input[name="mcp-oauth-project"]')].map((input) => input.name)).size).toBe(1);
  });

  it('shows no organization heading when every website belongs to one organization', async () => {
    hooks.authorization.mockReturnValue(authorization());
    const container = await render(<McpOAuthProjectStep />);
    expect(container.querySelector('[data-slot="organization-group"]')?.getAttribute('role')).toBeNull();
    expect(container.textContent).not.toContain('Acme');
    expect(container.textContent).toContain('oauth.project.projectLabel');
  });

  it('explains when the person belongs to no project', async () => {
    hooks.authorization.mockReturnValue(authorization({ projects: [] }));
    expect((await render(<McpOAuthProjectStep />)).textContent).toContain('oauth.project.noProjects');
  });
});

describe('MCP OAuth consent step', () => {
  it('names the project, the preset and the return target, and warns about self-registered apps', async () => {
    hooks.authorization.mockReturnValue(
      authorization({ selection: { id: 'g1', preset: 'read_only', scopes: ['mcp:connect', 'pages:read'], project: { id: 'p1', name: 'Docs' } } }),
    );
    const container = await render(<McpOAuthConsentStep />);
    expect(container.textContent).toContain('oauth.consent.summary');
    expect(container.textContent).toContain('claude.ai');
    expect(container.textContent).toContain('oauth.consent.unverified');
    expect(container.textContent).toContain('oauth.consent.cannot.change');
    expect(container.querySelector(`a[href="/oauth/project?oauth_request=${signed}"]`)).not.toBeNull();
  });

  it('sends the person back to choose a project when none is pending', async () => {
    hooks.authorization.mockReturnValue(authorization());
    expect((await render(<McpOAuthConsentStep />)).textContent).toContain('oauth.consent.noProject');
  });
});
