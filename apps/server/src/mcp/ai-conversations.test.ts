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
  it('gates tools on analytics scope and audits every read', () => {
    const registerTool = vi.fn();
    const server = { registerTool };
    const principal = { apiKey: { scopes: [] as string[] }, project: { id: 'p', organizationId: 'o' } };
    registerAiConversationSurface(server as never, {} as never, principal as never);
    expect(registerTool).not.toHaveBeenCalled();
    principal.apiKey.scopes = ['analytics:read'];
    registerAiConversationSurface(server as never, {} as never, principal as never);
    expect(registerTool.mock.calls.map((c) => c[0])).toEqual([
      'list_ai_conversations',
      'get_ai_conversation',
      'get_ai_feedback_summary',
      'list_ai_content_gaps',
    ]);
    for (const [name, config, run] of registerTool.mock.calls) {
      expect(config.annotations.readOnlyHint).toBe(true);
      expect(config.inputSchema.safeParse({ unexpected: true }).success).toBe(false);
      run({ conversationId: 'c' });
      expect(runMcpReadTool).toHaveBeenLastCalledWith({}, principal, name, 'analytics:read', expect.any(Function));
    }
  });
});
