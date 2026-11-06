import { afterEach, describe, expect, it, vi } from 'vitest';
import { assistantSetup, ConnectionError, testAssistantConnection } from './assistant-setup';

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
    expect((await testAssistantConnection('private-key')).tools).toBe(1);
    expect(fetcher.mock.calls.map((call) => JSON.parse(call[1].body).method)).toEqual(['initialize', 'notifications/initialized', 'tools/call']);
    expect(fetcher.mock.calls[2]?.[0]).toBe('/api/mcp');
    expect(fetcher.mock.calls[2]?.[1].headers).toMatchObject({
      Authorization: 'Bearer private-key',
      'Mcp-Session-Id': 'session-1',
      'MCP-Protocol-Version': '2025-11-25',
      Accept: 'application/json, text/event-stream',
    });
  });
  it('reads the response for its own request from an SSE reply with several events', async () => {
    const sse = (body: string) => new Response(body, { headers: { 'content-type': 'text/event-stream' } });
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(sse('event: message\ndata: {"jsonrpc":"2.0","id":1,"result":{"protocolVersion":"2025-11-25"}}\n\n'))
        .mockResolvedValueOnce(new Response(null, { status: 202 }))
        .mockResolvedValueOnce(
          sse(
            [
              'event: message',
              'data: {"jsonrpc":"2.0","method":"notifications/progress","params":{"progress":1}}',
              '',
              'event: message',
              'data: {"jsonrpc":"2.0","id":2,',
              'data: "result":{"structuredContent":{"data":{"tools":[{"name":"a"},{"name":"b"}]}}}}',
              '',
              '',
            ].join('\n'),
          ),
        ),
    );
    expect((await testAssistantConnection('key')).tools).toBe(2);
  });

  it("dates the test's own key usage by the server clock, not the computer's", async () => {
    // The computer's clock is an hour fast; the server's `Date` is what counts.
    vi.useFakeTimers({ now: Date.parse('2026-11-06T13:00:00Z'), toFake: ['Date'] });
    const date = { date: 'Fri, 06 Nov 2026 12:00:07 GMT' };
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(Response.json({ result: { protocolVersion: '2025-11-25' } }, { headers: date }))
        .mockResolvedValueOnce(new Response(null, { status: 202, headers: date }))
        .mockResolvedValueOnce(Response.json({ result: { structuredContent: { data: { tools: [] } } } }, { headers: date })),
    );
    try {
      // One second past the response time: `Date` has one-second precision.
      expect((await testAssistantConnection('key')).usedUntil).toBe(Date.parse('2026-11-06T12:00:08Z'));
    } finally {
      vi.useRealTimers();
    }
  });
  it('reports how far the key was used when the test fails after the server answered', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('denied', { status: 403, headers: { date: 'Fri, 06 Nov 2026 12:00:07 GMT' } })));
    const failure = await testAssistantConnection('key').catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(ConnectionError);
    expect((failure as ConnectionError).usedUntil).toBe(Date.parse('2026-11-06T12:00:08Z'));
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('offline')));
    expect(await testAssistantConnection('key').catch((error: unknown) => error)).not.toBeInstanceOf(ConnectionError);
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
