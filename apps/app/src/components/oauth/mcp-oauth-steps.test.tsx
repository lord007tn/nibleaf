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
});

const signed = Buffer.from('client_id=c1&ba_param=client_id&sig=abc').toString('base64url');
const authorization = (overrides: object = {}) => ({
  isPending: false,
  isError: false,
  data: {
    client: { clientId: 'c1', name: 'Claude', uri: null, redirectTarget: 'claude.ai', verifiedDomain: null },
    requestedScopes: ['mcp:connect', 'pages:read', 'offline_access'],
    projects: [{ id: 'p1', name: 'Docs', role: 'member', presets: ['read_only', 'support_writer'] }],
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
