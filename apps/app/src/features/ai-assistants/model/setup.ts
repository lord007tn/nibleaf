/** Copy-paste setup for one personal key. The secret goes only into snippets
 *  the person copies themselves; install links never carry it. */
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

/** Sign-in (OAuth) setup: the URL is all a client needs; it opens Nibleaf's
 *  sign-in page on first use. */
export function oauthAssistantSetup(endpoint: string) {
  const server = { url: endpoint };
  return {
    claudeCode: `claude mcp add --transport http nibleaf ${JSON.stringify(endpoint)}`,
    editors: JSON.stringify({ mcpServers: { nibleaf: server } }, null, 2),
    vscode: JSON.stringify({ servers: { nibleaf: { type: 'http', url: endpoint } } }, null, 2),
    cursorLink: `cursor://anysphere.cursor-deeplink/mcp/install?name=nibleaf&config=${encodeURIComponent(btoa(JSON.stringify(server)))}`,
    vscodeLink: `vscode:mcp/install?${encodeURIComponent(JSON.stringify({ name: 'nibleaf', type: 'http', url: endpoint }))}`,
  };
}
