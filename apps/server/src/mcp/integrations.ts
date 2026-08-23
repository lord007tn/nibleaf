import type { McpServer } from '@modelcontextprotocol/server';
import type { Context } from 'hono';
import { getGitWorkspaceStatus } from '@/actions/git/workflow';
import type { HonoEnv } from '@/lib/hono/context';
import { runMcpReadTool } from './result';
import type { McpPrincipal } from './types';

const getGitIntegrationStatusDto = async (projectId: string) => {
  const connection = await getGitWorkspaceStatus(projectId);
  if (!connection) return null;
  return {
    id: connection.id,
    provider: connection.provider,
    repository: connection.repository,
    baseBranch: connection.baseBranch,
    headBranch: connection.headBranch,
    importVersionId: connection.importBranchId,
    importLanguageId: connection.importLanguageId,
    lastSyncStatus: connection.lastSyncStatus,
    hasLastSyncError: Boolean(connection.lastSyncError),
    lastSyncedAt: connection.lastSyncedAt?.toISOString() ?? null,
    credentialConfigured: connection.credentialConfigured,
    webhookConfigured: connection.webhookConfigured,
    operations: connection.operations.map((operation) => ({
      id: operation.id,
      kind: operation.kind,
      status: operation.status,
      baseBranch: operation.baseBranch,
      headBranch: operation.headBranch,
      remoteSha: operation.remoteSha,
      pullRequestNumber: operation.pullRequestNo,
      conflictCount: operation.conflicts.length,
      hasError: Boolean(operation.error),
      createdAt: operation.createdAt.toISOString(),
      startedAt: operation.startedAt?.toISOString() ?? null,
      completedAt: operation.completedAt?.toISOString() ?? null,
    })),
    pullRequests: connection.pullRequests.map((pullRequest) => ({
      id: pullRequest.id,
      number: pullRequest.number,
      url: pullRequest.url,
      title: pullRequest.title,
      state: pullRequest.state,
      draft: pullRequest.draft,
      baseBranch: pullRequest.baseBranch,
      headBranch: pullRequest.headBranch,
      headSha: pullRequest.headSha,
      preview: pullRequest.previews[0]
        ? {
            available: pullRequest.previews[0].status === 'READY',
            status: pullRequest.previews[0].status,
            hasError: Boolean(pullRequest.previews[0].error),
            createdAt: pullRequest.previews[0].createdAt.toISOString(),
            completedAt: pullRequest.previews[0].completedAt?.toISOString() ?? null,
          }
        : null,
      updatedAt: pullRequest.updatedAt.toISOString(),
    })),
    audit: connection.auditEvents.map((event) => ({ id: event.id, action: event.action, createdAt: event.createdAt.toISOString() })),
    createdAt: connection.createdAt.toISOString(),
    updatedAt: connection.updatedAt.toISOString(),
  };
};

export const registerIntegrationSurface = (server: McpServer, ctx: Context<HonoEnv>, principal: McpPrincipal) => {
  if (!principal.apiKey.scopes.includes('integrations:read')) return;
  server.registerTool(
    'get_git_integration_status',
    {
      title: 'Get Git integration status',
      description:
        'Get redacted Git connection, sync, pull-request, preview, and audit status. Credentials, webhook secrets, request payloads, file paths, conflict content, and raw errors are excluded.',
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    () => runMcpReadTool(ctx, principal, 'get_git_integration_status', 'integrations:read', () => getGitIntegrationStatusDto(principal.project.id)),
  );
};
