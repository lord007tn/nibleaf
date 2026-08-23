import type { McpServer } from '@modelcontextprotocol/server';
import type { Context } from 'hono';
import { z } from 'zod';
import type { HonoEnv } from '@/lib/hono/context';
import { getDeploymentDto, getExportDto, getLatestDeploymentDto, getPendingChangesDto, listDeploymentDtos, listExportDtos } from './dto';
import { runMcpReadTool, runMcpResource } from './result';
import type { McpPrincipal } from './types';

const readOnly = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } as const;
const idInput = (label: string) => z.object({ id: z.string().trim().min(1).describe(label) }).strict();

export const registerOperationSurface = (server: McpServer, ctx: Context<HonoEnv>, principal: McpPrincipal) => {
  if (principal.apiKey.scopes.includes('exports:read')) {
    server.registerTool(
      'list_exports',
      { title: 'List exports', description: 'List export jobs without storage keys, checksums, or download URLs.', annotations: readOnly },
      () => runMcpReadTool(ctx, principal, 'list_exports', 'exports:read', () => listExportDtos(principal.project.id)),
    );
    server.registerTool(
      'get_export',
      { title: 'Get export', description: 'Get one redacted export summary.', inputSchema: idInput('Export job ID'), annotations: readOnly },
      ({ id }) => runMcpReadTool(ctx, principal, 'get_export', 'exports:read', () => getExportDto(principal.project.id, id)),
    );
  }

  if (principal.apiKey.scopes.includes('deployments:read')) {
    server.registerTool(
      'list_deployments',
      { title: 'List deployments', description: 'List deployment summaries without snapshots or raw provider errors.', annotations: readOnly },
      () => runMcpReadTool(ctx, principal, 'list_deployments', 'deployments:read', () => listDeploymentDtos(principal.project.id)),
    );
    server.registerTool(
      'get_deployment',
      {
        title: 'Get deployment',
        description: 'Get one deployment summary without its immutable content snapshot.',
        inputSchema: idInput('Deployment ID'),
        annotations: readOnly,
      },
      ({ id }) => runMcpReadTool(ctx, principal, 'get_deployment', 'deployments:read', () => getDeploymentDto(principal.project.id, id)),
    );
    server.registerTool(
      'get_pending_changes',
      { title: 'Get pending changes', description: 'Get publish-change metadata without authored diff lines.', annotations: readOnly },
      () => runMcpReadTool(ctx, principal, 'get_pending_changes', 'deployments:read', () => getPendingChangesDto(principal.project.id)),
    );
    server.registerResource(
      'latest-deployment',
      `nibleaf://projects/${principal.project.id}/deployments/latest`,
      {
        title: 'Latest Nibleaf deployment',
        description: 'Latest READY deployment summary without its content snapshot.',
        mimeType: 'application/json',
      },
      (uri) => runMcpResource(ctx, principal, 'latest-deployment', 'deployments:read', uri, () => getLatestDeploymentDto(principal.project.id)),
    );
  }
};
