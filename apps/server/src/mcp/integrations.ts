import type { McpServer } from '@modelcontextprotocol/server';
import type { IntegrationCatalogEntry, IntegrationConnectionSummary } from '@nibleaf/shared/integrations';
import { integrationProviderIdSchema } from '@nibleaf/validators';
import type { Context } from 'hono';
import { z } from 'zod';
import { getGitWorkspaceStatus } from '@/actions/git/workflow';
import { getProjectIntegration, listProjectIntegrations } from '@/actions/integrations';
import type { HonoEnv } from '@/lib/hono/context';
import { runMcpReadTool, runMcpResource } from './result';
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

const integrationInput = z.object({ providerId: integrationProviderIdSchema }).strict();

const connectionDto = (connection: IntegrationConnectionSummary | null) =>
  connection
    ? {
        id: connection.id,
        providerId: connection.providerId,
        category: connection.category,
        ownership: connection.ownership,
        status: connection.status,
        health: connection.health,
        credential: connection.credential,
        config: connection.config,
        revision: connection.revision,
        createdAt: connection.createdAt,
        updatedAt: connection.updatedAt,
      }
    : null;

const integrationDto = (entry: IntegrationCatalogEntry) => ({
  id: entry.id,
  category: entry.category,
  capabilities: entry.capabilities,
  ownership: entry.ownership,
  authKind: entry.authKind,
  lifecycle: entry.lifecycle,
  supportsActivation: entry.supportsActivation,
  supportsCredentialFreeUpdate: entry.supportsCredentialFreeUpdate,
  supportsDelete: entry.supportsDelete,
  supportsPassiveVerification: entry.supportsPassiveVerification,
  verificationSideEffect: entry.verificationSideEffect,
  navigation: entry.navigation,
  availability: entry.availability,
  connection: connectionDto(entry.connection),
});

const listIntegrationsDto = async (ctx: Context<HonoEnv>, projectId: string) =>
  (await listProjectIntegrations(ctx, projectId)).map((entry) => integrationDto(entry));

export const registerIntegrationSurface = (server: McpServer, ctx: Context<HonoEnv>, principal: McpPrincipal) => {
  if (!principal.apiKey.scopes.includes('integrations:read')) return;
  const readOnly = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } as const;
  server.registerTool(
    'list_integrations',
    {
      title: 'List integrations',
      description:
        'List the truth-based provider catalog and redacted project connection summaries. Credentials and raw provider payloads are excluded.',
      annotations: readOnly,
    },
    () => runMcpReadTool(ctx, principal, 'list_integrations', 'integrations:read', () => listIntegrationsDto(ctx, principal.project.id)),
  );
  server.registerResource(
    'integrations',
    `nibleaf://projects/${principal.project.id}/integrations`,
    { title: 'Nibleaf project integrations', mimeType: 'application/json' },
    (uri) => runMcpResource(ctx, principal, 'integrations', 'integrations:read', uri, () => listIntegrationsDto(ctx, principal.project.id)),
  );
  server.registerTool(
    'get_integration',
    {
      title: 'Get integration',
      description: 'Read one provider catalog entry and its redacted connection summary.',
      inputSchema: integrationInput,
      annotations: readOnly,
    },
    ({ providerId }) =>
      runMcpReadTool(ctx, principal, 'get_integration', 'integrations:read', async () =>
        integrationDto(await getProjectIntegration(ctx, principal.project.id, providerId)),
      ),
  );
  server.registerTool(
    'get_git_integration_status',
    {
      title: 'Get Git integration status',
      description:
        'Get redacted Git connection, sync, pull-request, preview, and audit status. Credentials, webhook secrets, request payloads, file paths, conflict content, and raw errors are excluded.',
      annotations: readOnly,
    },
    () => runMcpReadTool(ctx, principal, 'get_git_integration_status', 'integrations:read', () => getGitIntegrationStatusDto(principal.project.id)),
  );
};
