import type { McpScope } from '@nibleaf/shared/mcp';

export function assistantSetup(endpoint: string, secret: string) {
  // biome-ignore lint/suspicious/noTemplateCurlyInString: Cursor expands this environment reference.
  const headers = { Authorization: 'Bearer ${env:NIBLEAF_API_KEY}' };
  const cursor = { url: endpoint, headers };
  const inputs = [{ id: 'nibleaf-key', type: 'promptString', description: 'Nibleaf API key', password: true }];
  // biome-ignore lint/suspicious/noTemplateCurlyInString: VS Code resolves its password input.
  const vscode = { name: 'nibleaf', type: 'http', url: endpoint, headers: { Authorization: 'Bearer ${input:nibleaf-key}' }, inputs };
  return {
    claudeCode: `claude mcp add --transport http nibleaf ${JSON.stringify(endpoint)} --header "Authorization: Bearer ${secret}"`,
    desktop: JSON.stringify(
      {
        mcpServers: {
          nibleaf: {
            command: 'npx',
            // biome-ignore lint/suspicious/noTemplateCurlyInString: mcp-remote expands the environment reference.
            args: ['-y', 'mcp-remote', endpoint, '--header', 'Authorization:${NIBLEAF_AUTH}'],
            env: { NIBLEAF_AUTH: `Bearer ${secret}` },
          },
        },
      },
      null,
      2,
    ),
    cursor: JSON.stringify({ mcpServers: { nibleaf: cursor } }, null, 2),
    cursorLink: `cursor://anysphere.cursor-deeplink/mcp/install?name=nibleaf&config=${encodeURIComponent(btoa(JSON.stringify(cursor)))}`,
    vscode: JSON.stringify({ inputs, servers: { nibleaf: { type: 'http', url: endpoint, headers: vscode.headers } } }, null, 2),
    vscodeLink: `vscode:mcp/install?${encodeURIComponent(JSON.stringify(vscode))}`,
  };
}

export class ConnectionError extends Error {}

/** Streamable HTTP may return either JSON or SSE. Never expose response bodies in errors. */
export async function testAssistantConnection(secret: string): Promise<number> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${secret}`,
    'Content-Type': 'application/json',
    Accept: 'application/json, text/event-stream',
  };
  const call = async (method: string, params?: object, id?: number) => {
    const response = await fetch('/api/mcp', {
      method: 'POST',
      headers,
      body: JSON.stringify({ jsonrpc: '2.0', ...(id ? { id } : {}), method, params }),
      signal: AbortSignal.timeout(15_000),
      cache: 'no-store',
      credentials: 'omit',
    });
    if (!response.ok)
      throw new ConnectionError(
        response.status === 401 ? 'invalidKey' : response.status === 404 || response.status === 503 ? 'disabled' : 'connectionError',
      );
    const session = response.headers.get('mcp-session-id');
    if (session) headers['Mcp-Session-Id'] = session;
    if (!id) {
      await response.body?.cancel();
      return;
    }
    const text = await response.text();
    const payload = response.headers.get('content-type')?.includes('text/event-stream')
      ? JSON.parse(
          text
            .split(/\r?\n/)
            .filter((line) => line.startsWith('data:'))
            .map((line) => line.slice(5).trim())
            .join('\n'),
        )
      : JSON.parse(text);
    if (payload.error || payload.result?.isError) throw new ConnectionError('connectionError');
    return payload.result;
  };
  const initialized = await call(
    'initialize',
    { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'nibleaf-dashboard-test', version: '1.0.0' } },
    1,
  );
  headers['MCP-Protocol-Version'] = initialized.protocolVersion;
  await call('notifications/initialized');
  const result = await call('tools/call', { name: 'get_capabilities', arguments: {} }, 2);
  const data = result.structuredContent?.data ?? JSON.parse(result.content.find((item: { type: string }) => item.type === 'text').text).data;
  if (!Array.isArray(data?.tools)) throw new ConnectionError('connectionError');
  return (data.tools as Array<{ scope: McpScope }>).length;
}
