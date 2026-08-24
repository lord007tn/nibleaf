import { prisma } from '@nibleaf/database';
import { DOCUMENTATION_COMPONENT_CATALOG, DOCUMENTATION_COMPONENT_SCHEMA_VERSION } from '@nibleaf/shared/documentation-components';
import { THEME_REPOSITORY_SCHEMA_VERSION, THEME_RUNTIME_CONTRACT_VERSION } from '@nibleaf/shared/theme-repository';
import {
  applyThemeTemplateConfig,
  canonicalThemeTemplateJson,
  previewThemeConfigChanges,
  resolveTheme,
  THEME_PRESETS,
  THEME_SCHEMA_VERSION,
  themeOwnedConfig,
  themeTemplateFromConfig,
} from '@nibleaf/shared/themes';
import { parseThemeTemplate, type ThemeImportBody, themeTemplateV1Schema } from '@nibleaf/validators';
import { z } from 'zod';
import { badRequest } from '@/errors';
import { mutateProjectConfig } from './project-config';
import { assertProjectInOrg } from './projects';

const projectConfigRecordSchema = z.record(z.string(), z.json()).catch({});
const recordConfig = (value: unknown) => projectConfigRecordSchema.parse(value);
const parsedThemeOwnedConfig = (current: Record<string, unknown>) => {
  const theme = themeTemplateV1Schema.shape.config.shape.theme.safeParse(current.theme);
  const styling = themeTemplateV1Schema.shape.config.shape.styling.safeParse(current.styling);
  const typography = themeTemplateV1Schema.shape.config.shape.typography.safeParse(current.typography);
  const branding = themeTemplateV1Schema.shape.config.shape.branding.safeParse(current.branding);
  return {
    ...(theme.success && theme.data ? { theme: theme.data } : {}),
    ...(styling.success && styling.data ? { styling: styling.data } : {}),
    ...(typography.success && typography.data ? { typography: typography.data } : {}),
    ...(branding.success && branding.data ? { branding: branding.data } : {}),
  };
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

  const incoming = {
    ...parsed.template.config,
    theme: {
      version: THEME_SCHEMA_VERSION,
      preset: parsed.template.config.theme?.preset ?? 'harbor',
      ...parsed.template.config.theme,
      metadata: parsed.template.metadata,
    },
  };
  const deriveImport = (current: Record<string, unknown>) => {
    // Parse only the four theme-owned sections. Unknown and malformed sibling
    // JSON remains opaque and is preserved by applyThemeTemplateConfig.
    const normalizedCurrent = applyThemeTemplateConfig(current, parsedThemeOwnedConfig(current), 'replace');
    const next = applyThemeTemplateConfig(normalizedCurrent, incoming, body.mode);
    return { current, next, changes: previewThemeConfigChanges(current, next) };
  };
  const result = (current: Record<string, unknown>) => {
    const derived = deriveImport(current);
    return {
      applied: body.apply,
      mode: body.mode,
      migratedFrom: parsed.migratedFrom,
      changes: derived.changes,
      theme: resolveTheme(parsedThemeOwnedConfig(derived.next)),
      template: themeTemplateFromConfig(derived.next),
      // Public delivery remains tied to the next immutable READY deployment.
      publishedChangesPending: body.apply && derived.changes.length > 0,
    };
  };

  if (!body.apply) {
    const project = await assertProjectInOrg(organizationId, projectId);
    return result(recordConfig(project.config));
  }

  let appliedCurrent: Record<string, unknown> = {};
  await prisma.$transaction(async (tx) => {
    await mutateProjectConfig(tx, organizationId, projectId, (current) => {
      appliedCurrent = current;
      return deriveImport(current).next;
    });
  });

  return result(appliedCurrent);
};
