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
  // Registered for API keys and OAuth grants alike; each call also re-checks the
  // scope and is audited and rate limited like every other read tool.
  if (!principal.credential.scopes.includes('analytics:read')) return;
  const annotations = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };
  const org = principal.project.organizationId;
  const project = principal.project.id;
  server.registerTool(
    'get_ai_usage',
    {
      description:
        'AI assistant spend per day and model, with totals. Counts every turn a provider billed, automated traffic included, so its question count can exceed get_ai_feedback_summary (people only): questions, answered, unanswered, failed and cancelled answers, tokens (a stopped or failed answer contributes an estimate), cost in USD (only for answers whose provider reported it; see costKnownAnswers), average answer and first-token times in milliseconds, and retrieval cache hits.',
      inputSchema: aiConversationSummaryQuery,
      annotations,
    },
    (query) => runMcpReadTool(ctx, principal, 'get_ai_usage', 'analytics:read', () => getProjectAiUsage(org, project, query)),
  );
  server.registerTool(
    'list_ai_conversations',
    {
      description:
        'Find conversations readers had with your docs assistant, with answer and feedback filters. Question text is present only when capture is on; captureOffReason says why it is off (setting: the site setting; instance: no encryption key on the server).',
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
      description:
        'Understand how often your docs assistant answers readers, which answers receive useful feedback, what it costs, and how readers use it (engagement: opens by source, source and follow-up clicks, copies, stops, new chats, rating changes, limits reached, provider errors, median response times). Question, answer and engagement counts are people only (declared bots and scripts are left out); usage and cost cover every billed turn, as in get_ai_usage.',
      inputSchema: aiConversationSummaryQuery,
      annotations,
    },
    (query) =>
      runMcpReadTool(ctx, principal, 'get_ai_feedback_summary', 'analytics:read', () => getProjectAiConversationSummary(org, project, query)),
  );
  server.registerTool(
    'list_ai_content_gaps',
    {
      description:
        'Find questions readers asked that the docs could not answer or rated down; good candidates for new articles. Follow-up questions appear as their standalone rewrite.',
      inputSchema: aiContentGapsQuery,
      annotations,
    },
    (query) => runMcpReadTool(ctx, principal, 'list_ai_content_gaps', 'analytics:read', () => listProjectAiContentGaps(org, project, query)),
  );
};
