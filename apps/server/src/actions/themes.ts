import { type Prisma, prisma } from '@nibleaf/database';
import {
  applyThemeTemplateConfig,
  canonicalThemeTemplateJson,
  previewThemeConfigChanges,
  resolveTheme,
  THEME_SCHEMA_VERSION,
  type ThemeOwnedProjectConfig,
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
