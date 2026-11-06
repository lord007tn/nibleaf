import { afterEach, describe, expect, it, vi } from 'vitest';
import { assistantSetup, testAssistantConnection } from './assistant-setup';

afterEach(() => vi.unstubAllGlobals());
describe('assistant setup', () => {
  it('includes the endpoint in every config while keeping secrets out of installation URLs', () => {
    const endpoint = 'https://docs.example/api/mcp';
    const setup = assistantSetup(endpoint, 'private-once-key');
    for (const snippet of [setup.claudeCode, setup.desktop, setup.cursor, setup.vscode]) expect(snippet).toContain(endpoint);
    expect(setup.cursorLink).not.toContain('private-once-key');
    expect(atob(new URL(setup.cursorLink).searchParams.get('config') ?? '')).not.toContain('private-once-key');
    expect(decodeURIComponent(setup.vscodeLink)).not.toContain('private-once-key');
    expect(JSON.parse(setup.vscode).inputs[0]).toMatchObject({ type: 'promptString', password: true });
    expect(JSON.parse(setup.desktop).mcpServers.nibleaf.env.NIBLEAF_AUTH).toBe('Bearer private-once-key');
  });
  it('initializes before calling capabilities and honors session/protocol headers', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ result: { protocolVersion: '2025-11-25' } }, { headers: { 'mcp-session-id': 'session-1' } }))
      .mockResolvedValueOnce(new Response(null, { status: 202 }))
      .mockResolvedValueOnce(Response.json({ result: { structuredContent: { data: { tools: [{ name: 'get_capabilities' }] } } } }));
    vi.stubGlobal('fetch', fetcher);
    expect(await testAssistantConnection('private-key')).toBe(1);
    expect(fetcher.mock.calls.map((call) => JSON.parse(call[1].body).method)).toEqual(['initialize', 'notifications/initialized', 'tools/call']);
    expect(fetcher.mock.calls[2]?.[0]).toBe('/api/mcp');
    expect(fetcher.mock.calls[2]?.[1].headers).toMatchObject({
      Authorization: 'Bearer private-key',
      'Mcp-Session-Id': 'session-1',
      'MCP-Protocol-Version': '2025-11-25',
      Accept: 'application/json, text/event-stream',
    });
  });
  it.each([
    [401, 'invalidKey'],
    [503, 'disabled'],
    [403, 'connectionError'],
  ] as const)('reports HTTP %s without revealing server payloads', async (status, message) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('sensitive detail', { status })));
    await expect(testAssistantConnection('secret')).rejects.toThrow(message);
  });
});
