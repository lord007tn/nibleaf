import { type McpServer, ResourceTemplate } from '@modelcontextprotocol/server';
import type { Context } from 'hono';
import { z } from 'zod';
import { AppError } from '@/errors';
import type { HonoEnv } from '@/lib/hono/context';
import { getPageDto, getProjectDto, listLanguageDtos, listPageDtos, listVersionDtos } from './dto';
import { runMcpReadTool, runMcpResource } from './result';
import type { McpPrincipal } from './types';

const readOnly = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } as const;
const pageResourceVariables = z.object({ projectId: z.string().trim().min(1), pageId: z.string().trim().min(1) }).strict();

export const registerContentSurface = (server: McpServer, ctx: Context<HonoEnv>, principal: McpPrincipal) => {
  if (principal.apiKey.scopes.includes('projects:read')) {
    server.registerTool(
      'get_project',
      { title: 'Get project', description: 'Get a safe summary of the bound Nibleaf project.', annotations: readOnly },
      () =>
        runMcpReadTool(ctx, principal, 'get_project', 'projects:read', () => getProjectDto(principal.project.organizationId, principal.project.id)),
    );
    server.registerResource(
      'project',
      `nibleaf://projects/${principal.project.id}`,
      { title: 'Bound Nibleaf project', mimeType: 'application/json' },
      (uri) =>
        runMcpResource(ctx, principal, 'project', 'projects:read', uri, () => getProjectDto(principal.project.organizationId, principal.project.id)),
    );
  }

  if (principal.apiKey.scopes.includes('pages:read')) {
    server.registerTool(
      'list_pages',
      {
        title: 'List pages',
        description: 'List page metadata in the bound project. Optional language and version IDs are revalidated by the shared page action.',
        inputSchema: z.object({ languageId: z.string().trim().min(1).optional(), versionId: z.string().trim().min(1).optional() }).strict(),
        annotations: readOnly,
      },
      ({ languageId, versionId }) =>
        runMcpReadTool(ctx, principal, 'list_pages', 'pages:read', () => listPageDtos(principal.project.id, languageId, versionId)),
    );
    server.registerTool(
      'get_page',
      {
        title: 'Get page',
        description: 'Read one page, including authored content, from the bound project.',
        inputSchema: z.object({ pageId: z.string().trim().min(1) }).strict(),
        annotations: readOnly,
      },
      ({ pageId }) => runMcpReadTool(ctx, principal, 'get_page', 'pages:read', () => getPageDto(principal.project.id, pageId)),
    );
    server.registerResource(
      'pages',
      `nibleaf://projects/${principal.project.id}/pages`,
      { title: 'Nibleaf page index', mimeType: 'application/json' },
      (uri) => runMcpResource(ctx, principal, 'pages', 'pages:read', uri, () => listPageDtos(principal.project.id)),
    );
    server.registerResource(
      'page',
      new ResourceTemplate('nibleaf://projects/{projectId}/pages/{pageId}', { list: undefined }),
      { title: 'Nibleaf page', description: 'One authored page within the bound project.', mimeType: 'application/json' },
      (uri, variables) =>
        runMcpResource(ctx, principal, 'page', 'pages:read', uri, () => {
          const parsed = pageResourceVariables.safeParse(variables);
          if (!parsed.success || parsed.data.projectId !== principal.project.id) {
            throw new AppError({ code: 'database:not_found', message: 'Page not found.' });
          }
          return getPageDto(principal.project.id, parsed.data.pageId);
        }),
    );
  }

  if (principal.apiKey.scopes.includes('languages:read')) {
    server.registerTool(
      'list_languages',
      { title: 'List languages', description: 'List languages configured for the bound project.', annotations: readOnly },
      () => runMcpReadTool(ctx, principal, 'list_languages', 'languages:read', () => listLanguageDtos(principal.project.id)),
    );
    server.registerResource(
      'languages',
      `nibleaf://projects/${principal.project.id}/languages`,
      { title: 'Nibleaf project languages', mimeType: 'application/json' },
      (uri) => runMcpResource(ctx, principal, 'languages', 'languages:read', uri, () => listLanguageDtos(principal.project.id)),
    );
  }

  if (principal.apiKey.scopes.includes('versions:read')) {
    server.registerTool(
      'list_versions',
      { title: 'List versions', description: 'List documentation versions; version IDs are the shared branch IDs.', annotations: readOnly },
      () => runMcpReadTool(ctx, principal, 'list_versions', 'versions:read', () => listVersionDtos(principal.project.id)),
    );
    server.registerResource(
      'versions',
      `nibleaf://projects/${principal.project.id}/versions`,
      { title: 'Nibleaf project versions', mimeType: 'application/json' },
      (uri) => runMcpResource(ctx, principal, 'versions', 'versions:read', uri, () => listVersionDtos(principal.project.id)),
    );
  }
};
