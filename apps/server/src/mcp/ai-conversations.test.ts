import { describe, expect, it, vi } from 'vitest';

vi.mock('@/actions/ai-conversations', () => ({
  listProjectAiConversations: vi.fn(),
  getProjectAiConversation: vi.fn(),
  getProjectAiConversationSummary: vi.fn(),
  listProjectAiContentGaps: vi.fn(),
}));
vi.mock('./result', () => ({ runMcpReadTool: vi.fn() }));

import { registerAiConversationSurface } from './ai-conversations';
import { runMcpReadTool } from './result';

describe('AI conversation MCP', () => {
  const credential = (kind: 'api_key' | 'oauth', scopes: string[]) => ({
    kind,
    id: `${kind}-1`,
    name: kind === 'oauth' ? 'Claude' : 'Support key',
    ...(kind === 'oauth' ? { clientId: 'client-1' } : {}),
    scopes,
    expiresAt: new Date('2027-01-01T00:00:00.000Z'),
  });
  const principalWith = (kind: 'api_key' | 'oauth', scopes: string[]) => ({
    credential: credential(kind, scopes),
    project: { id: 'p', name: 'Docs', organizationId: 'o' },
    actor: { userId: 'u', role: 'admin' },
  });

  it.each(['api_key', 'oauth'] as const)('gates tools on the analytics scope of an %s credential and audits every read', (kind) => {
    const registerTool = vi.fn();
    const server = { registerTool };
    registerAiConversationSurface(server as never, {} as never, principalWith(kind, ['mcp:connect']) as never);
    expect(registerTool).not.toHaveBeenCalled();
    const principal = principalWith(kind, ['mcp:connect', 'analytics:read']);
    registerAiConversationSurface(server as never, {} as never, principal as never);
    expect(registerTool.mock.calls.map((c) => c[0])).toEqual([
      'get_ai_usage',
      'list_ai_conversations',
      'get_ai_conversation',
      'get_ai_feedback_summary',
      'list_ai_content_gaps',
    ]);
    for (const [name, config, run] of registerTool.mock.calls) {
      expect(config.annotations.readOnlyHint).toBe(true);
      expect(config.inputSchema.safeParse({ unexpected: true }).success).toBe(false);
      run({ conversationId: 'c' });
      // runMcpReadTool re-checks the scope, audits the call and reports errors safely.
      expect(runMcpReadTool).toHaveBeenLastCalledWith({}, principal, name, 'analytics:read', expect.any(Function));
    }
  });
});
