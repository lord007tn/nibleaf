import type { McpServer } from '@modelcontextprotocol/server';
import { themeImportBodySchema } from '@nibleaf/validators';
import type { Context } from 'hono';
import { exportProjectTheme, getProjectThemeCatalog, importProjectTheme } from '@/actions/themes';
import type { HonoEnv } from '@/lib/hono/context';
import { runMcpReadTool, runMcpResource } from './result';
import type { McpPrincipal } from './types';

const getThemeTemplateDto = async (organizationId: string, projectId: string) => {
  const exported = await exportProjectTheme(organizationId, projectId);
  return { schemaVersion: exported.template.version, template: exported.template };
};

const previewThemeImportDto = async (organizationId: string, projectId: string, input: { template: unknown; mode: 'merge' | 'replace' }) => {
  const preview = await importProjectTheme(organizationId, projectId, { ...input, apply: false });
  return {
    applied: false as const,
    mode: preview.mode,
    migratedFrom: preview.migratedFrom,
    changes: preview.changes,
    theme: preview.theme,
    template: preview.template,
    publishedChangesPending: false as const,
  };
};

const getThemeCatalogDto = async (organizationId: string, projectId: string) => {
  const catalog = await getProjectThemeCatalog(organizationId, projectId);
  return {
    schemaVersion: catalog.schemaVersion,
    repositorySchemaVersion: catalog.repositorySchemaVersion,
    runtimeContractVersion: catalog.runtimeContractVersion,
    componentSchemaVersion: catalog.componentSchemaVersion,
    current: catalog.current,
    presets: catalog.presets,
    authoring: catalog.authoring,
  };
};

export const registerThemeSurface = (server: McpServer, ctx: Context<HonoEnv>, principal: McpPrincipal) => {
  if (!principal.apiKey.scopes.includes('themes:read')) return;
  const readOnly = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } as const;
  server.registerTool(
    'get_theme_catalog',
    {
      title: 'Get theme catalog',
      description: 'Read safe theme preset and documentation-component capability metadata without customer content or repository internals.',
      annotations: readOnly,
    },
    () =>
      runMcpReadTool(ctx, principal, 'get_theme_catalog', 'themes:read', () =>
        getThemeCatalogDto(principal.project.organizationId, principal.project.id),
      ),
  );
  server.registerTool(
    'get_theme_template',
    {
      title: 'Get theme template',
      description: 'Export safe theme-template JSON without repository or filesystem internals.',
      annotations: readOnly,
    },
    () =>
      runMcpReadTool(ctx, principal, 'get_theme_template', 'themes:read', () =>
        getThemeTemplateDto(principal.project.organizationId, principal.project.id),
      ),
  );
  server.registerTool(
    'preview_theme_import',
    {
      title: 'Preview theme import',
      description: 'Validate and preview a merge or replace theme import without writing project state.',
      inputSchema: themeImportBodySchema.omit({ apply: true }),
      annotations: readOnly,
    },
    (input) =>
      runMcpReadTool(ctx, principal, 'preview_theme_import', 'themes:read', () =>
        previewThemeImportDto(principal.project.organizationId, principal.project.id, input),
      ),
  );
  server.registerResource(
    'theme-catalog',
    `nibleaf://projects/${principal.project.id}/theme-catalog`,
    { title: 'Nibleaf theme catalog', mimeType: 'application/json' },
    (uri) =>
      runMcpResource(ctx, principal, 'theme-catalog', 'themes:read', uri, () =>
        getThemeCatalogDto(principal.project.organizationId, principal.project.id),
      ),
  );
  server.registerResource(
    'theme-template',
    `nibleaf://projects/${principal.project.id}/theme-template`,
    { title: 'Nibleaf theme template', mimeType: 'application/json' },
    (uri) =>
      runMcpResource(ctx, principal, 'theme-template', 'themes:read', uri, () =>
        getThemeTemplateDto(principal.project.organizationId, principal.project.id),
      ),
  );
};
