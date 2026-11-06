import type { McpServer } from '@modelcontextprotocol/server';
import { aiContentGapsQuery, aiConversationListQuery, aiConversationSummaryQuery } from '@nibleaf/validators';
import type { Context } from 'hono';
import { z } from 'zod';
import {
  getProjectAiConversation,
  getProjectAiConversationSummary,
  getProjectAiUsage,
  listProjectAiContentGaps,
  listProjectAiConversations,
} from '@/actions/ai-conversations';
import type { HonoEnv } from '@/lib/hono/context';
import { runMcpReadTool } from './result';
import type { McpPrincipal } from './types';
export const registerAiConversationSurface = (server: McpServer, ctx: Context<HonoEnv>, principal: McpPrincipal) => {
  if (!principal.apiKey.scopes.includes('analytics:read')) return;
  const annotations = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };
  const org = principal.project.organizationId;
  const project = principal.project.id;
  server.registerTool(
    'get_ai_usage',
    {
      description: 'Daily per-model questions, outcomes, tokens, cost in micros, latency and first-token sums/counts, and retrieval cache hits.',
      inputSchema: aiConversationSummaryQuery,
      annotations,
    },
    (query) => runMcpReadTool(ctx, principal, 'get_ai_usage', 'analytics:read', () => getProjectAiUsage(org, project, query)),
  );
  server.registerTool(
    'list_ai_conversations',
    {
      description: 'Find conversations readers had with your docs assistant, with answer and feedback filters.',
      inputSchema: aiConversationListQuery,
      annotations,
    },
    (query) => runMcpReadTool(ctx, principal, 'list_ai_conversations', 'analytics:read', () => listProjectAiConversations(org, project, query)),
  );
  server.registerTool(
    'get_ai_conversation',
    {
      description: 'Read the saved redacted questions, answers and feedback for a docs conversation.',
      inputSchema: z.object({ conversationId: z.uuid() }).strict(),
      annotations,
    },
    ({ conversationId }) =>
      runMcpReadTool(ctx, principal, 'get_ai_conversation', 'analytics:read', () => getProjectAiConversation(org, project, conversationId)),
  );
  server.registerTool(
    'get_ai_feedback_summary',
    {
      description: 'Understand how often your docs assistant answers readers and which answers receive useful feedback.',
      inputSchema: aiConversationSummaryQuery,
      annotations,
    },
    (query) =>
      runMcpReadTool(ctx, principal, 'get_ai_feedback_summary', 'analytics:read', () => getProjectAiConversationSummary(org, project, query)),
  );
  server.registerTool(
    'list_ai_content_gaps',
    {
      description: 'Find questions readers asked that the docs could not answer; good candidates for new articles.',
      inputSchema: aiContentGapsQuery,
      annotations,
    },
    (query) => runMcpReadTool(ctx, principal, 'list_ai_content_gaps', 'analytics:read', () => listProjectAiContentGaps(org, project, query)),
  );
};
