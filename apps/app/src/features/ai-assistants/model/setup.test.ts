import { describe, expect, it } from 'vitest';
import { assistantSetup, oauthAssistantSetup } from './setup';

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
  it('gives sign-in clients the URL alone, in commands, configs and install links', () => {
    const endpoint = 'https://docs.example/api/mcp';
    const setup = oauthAssistantSetup(endpoint);
    expect(setup.claudeCode).toBe(`claude mcp add --transport http nibleaf "${endpoint}"`);
    expect(JSON.parse(setup.editors)).toEqual({ mcpServers: { nibleaf: { url: endpoint } } });
    expect(JSON.parse(setup.vscode)).toEqual({ servers: { nibleaf: { type: 'http', url: endpoint } } });
    expect(JSON.parse(atob(new URL(setup.cursorLink).searchParams.get('config') ?? ''))).toEqual({ url: endpoint });
    expect(JSON.parse(decodeURIComponent(setup.vscodeLink.slice('vscode:mcp/install?'.length)))).toEqual({
      name: 'nibleaf',
      type: 'http',
      url: endpoint,
    });
  });
});
