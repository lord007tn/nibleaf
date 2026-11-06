import { Hono } from 'hono';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@nibleaf/database', () => ({ prisma: {} }));
vi.mock('@/actions/mcp-oauth', () => ({ createMcpOAuthGrant: vi.fn(), getMcpOAuthAuthorization: vi.fn() }));
vi.mock('@nibleaf/auth/mcp-oauth', () => ({
  // Better Auth signs the parameters it lists in ba_param; keep only those.
  signedOAuthQuerySubset: (raw: string) => {
    const params = new URLSearchParams(raw);
    const names = new Set(params.getAll('ba_param'));
    if (!params.has('sig')) return null;
    const kept = new URLSearchParams();
    for (const [name, value] of params) if (name === 'sig' || name === 'ba_param' || names.has(name)) kept.append(name, value);
    return kept.toString();
  },
}));

import handlers from './handlers';

const app = new Hono().route('/api/app/mcp-oauth', handlers);
const signed = 'client_id=c1&scope=mcp%3Aconnect&ba_param=ba_param&ba_param=client_id&ba_param=scope&sig=abc';

describe('MCP OAuth hand-off from Better Auth to the dashboard', () => {
  it.each([
    ['sign-in', '/sign-in'],
    ['project', '/oauth/project'],
    ['consent', '/oauth/consent'],
  ])('wraps the signed query for the %s page in one opaque parameter', async (step, page) => {
    const response = await app.request(`https://app.nibleaf.test/api/app/mcp-oauth/handoff/${step}?${signed}&utm=x`);
    expect(response.status).toBe(302);
    expect(response.headers.get('cache-control')).toBe('no-store');
    const location = new URL(response.headers.get('location') ?? '', 'https://app.nibleaf.test');
    expect(location.pathname).toBe(page);
    expect([...location.searchParams.keys()]).toEqual(['oauth_request']);
    const unwrapped = Buffer.from(location.searchParams.get('oauth_request') ?? '', 'base64url').toString('utf8');
    // Repeated ba_param values survive intact; unsigned extras are dropped.
    expect(new URLSearchParams(unwrapped).getAll('ba_param')).toEqual(['ba_param', 'client_id', 'scope']);
    expect(unwrapped).not.toContain('utm');
  });

  it('only forwards to the three known pages', async () => {
    expect((await app.request('https://app.nibleaf.test/api/app/mcp-oauth/handoff/https%3A%2F%2Fevil.example')).status).toBe(404);
    const unsigned = await app.request('https://app.nibleaf.test/api/app/mcp-oauth/handoff/project?client_id=c1');
    expect(unsigned.headers.get('location')).toBe('/oauth/project');
  });
});
