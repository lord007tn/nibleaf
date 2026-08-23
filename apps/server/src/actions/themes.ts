import { type Prisma, prisma } from '@nibleaf/database';
import { DOCUMENTATION_COMPONENT_CATALOG, DOCUMENTATION_COMPONENT_SCHEMA_VERSION } from '@nibleaf/shared/documentation-components';
import { THEME_REPOSITORY_SCHEMA_VERSION, THEME_RUNTIME_CONTRACT_VERSION } from '@nibleaf/shared/theme-repository';
import {
  applyThemeTemplateConfig,
  canonicalThemeTemplateJson,
  previewThemeConfigChanges,
  resolveTheme,
  THEME_PRESETS,
  THEME_SCHEMA_VERSION,
  type ThemeOwnedProjectConfig,
  themeOwnedConfig,
  themeTemplateFromConfig,
} from '@nibleaf/shared/themes';
import { parseThemeTemplate, type ThemeImportBody } from '@nibleaf/validators';
import { z } from 'zod';
import { badRequest } from '@/errors';
import { assertProjectInOrg } from './projects';

const recordConfig = (value: Prisma.JsonValue | null) => {
  const parsed = z.record(z.string(), z.unknown()).safeParse(value);
  return parsed.success ? parsed.data : {};
};

export const exportProjectTheme = async (organizationId: string, projectId: string) => {
  const project = await assertProjectInOrg(organizationId, projectId);
  const template = themeTemplateFromConfig(recordConfig(project.config));
  return { template, json: canonicalThemeTemplateJson(template) };
};

/** JSON-safe capability discovery for product UI and least-privilege adapters.
 * The authenticated boundary derives organizationId; this action re-checks the
 * tenant and never returns repository files, snapshots, or customer content. */
export const getProjectThemeCatalog = async (organizationId: string, projectId: string) => {
  const project = await assertProjectInOrg(organizationId, projectId);
  const current = resolveTheme(themeOwnedConfig(recordConfig(project.config)));
  return {
    schemaVersion: THEME_SCHEMA_VERSION,
    repositorySchemaVersion: THEME_REPOSITORY_SCHEMA_VERSION,
    runtimeContractVersion: THEME_RUNTIME_CONTRACT_VERSION,
    componentSchemaVersion: DOCUMENTATION_COMPONENT_SCHEMA_VERSION,
    current: { id: current.id, repositoryMetadata: current.metadata, layout: current.layout, components: current.components },
    presets: Object.values(THEME_PRESETS).map((preset) => ({
      id: preset.id,
      messageKeys: {
        name: `settings.theme.preset.${preset.id}.name`,
        description: `settings.theme.preset.${preset.id}.description`,
        rationale: `settings.theme.preset.${preset.id}.rationale`,
      },
      layout: preset.layout,
      components: preset.components,
    })),
    authoring: DOCUMENTATION_COMPONENT_CATALOG,
  };
};

const validationIssues = (issues?: ReadonlyArray<{ path: ReadonlyArray<PropertyKey>; message: string }>) =>
  Array.isArray(issues)
    ? issues.slice(0, 20).map((issue) => ({
        path: issue.path.length > 0 ? issue.path.map(String).join('.') : '$',
        message: issue.message,
      }))
    : undefined;

export const importProjectTheme = async (organizationId: string, projectId: string, body: ThemeImportBody) => {
  const parsed = parseThemeTemplate(body.template);
  if (!parsed.success) {
    throw badRequest(parsed.message, { errors: validationIssues(parsed.issues) });
  }

  const project = await assertProjectInOrg(organizationId, projectId);
  const current = recordConfig(project.config);
  const incoming: ThemeOwnedProjectConfig = {
    ...parsed.template.config,
    theme: {
      version: THEME_SCHEMA_VERSION,
      preset: parsed.template.config.theme?.preset ?? 'harbor',
      ...parsed.template.config.theme,
      metadata: parsed.template.metadata,
    },
  };
  const next = applyThemeTemplateConfig(current, incoming, body.mode);
  const changes = previewThemeConfigChanges(current, next);

  if (body.apply && changes.length > 0) {
    await prisma.project.update({ where: { id: projectId }, data: { config: next as Prisma.InputJsonValue } });
  }

  return {
    applied: body.apply,
    mode: body.mode,
    migratedFrom: parsed.migratedFrom,
    changes,
    theme: resolveTheme(next as ThemeOwnedProjectConfig),
    template: themeTemplateFromConfig(next),
    // Public delivery remains tied to the next immutable READY deployment.
    publishedChangesPending: body.apply && changes.length > 0,
  };
};
