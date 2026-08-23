import { Prisma, prisma } from '@nibleaf/database';
import {
  ADDON_REGISTRY,
  type AddonDefinition,
  type AddonId,
  addonAuditActionSchema,
  addonAvailable,
  addonDefinitions,
  isAddonId,
  projectConfigWithAddons,
} from '@nibleaf/shared/addons';
import { MemberRole } from '@nibleaf/shared/constants';
import { roleAtLeast } from '@nibleaf/shared/rbac';
import { addonConfigSchemas, type ListProjectAddonAuditQuery, type MutateProjectAddonBody, type UpdateProjectAddonBody } from '@nibleaf/validators';
import type { Context } from 'hono';
import { z } from 'zod';
import { AppError, notFound } from '@/errors';
import type { HonoEnv } from '@/lib/hono/context';
import { mutateProjectConfig } from './project-config';
import { parseWorkspaceMetadata } from './workspace';

type AddonIntent = 'read' | 'write';

interface WorkspaceAvailability {
  plan: string;
  entitlements: Record<string, boolean>;
}

const authorizeProjectAddons = async (ctx: Context<HonoEnv>, projectId: string, intent: AddonIntent) => {
  const apiKey = ctx.get('apiKey');
  if (apiKey) {
    if (apiKey.projectId !== projectId) throw notFound('project', { id: projectId });
    const requiredScope = intent === 'read' ? 'addons:read' : 'addons:write';
    if (!apiKey.scopes.includes(requiredScope)) {
      throw new AppError({ code: 'auth:insufficient_role', message: `The API key requires ${requiredScope}.` });
    }
    const project = await prisma.project.findUnique({
      where: { id: projectId },
      select: { id: true, organizationId: true, config: true, organization: { select: { metadata: true } } },
    });
    if (!project) throw notFound('project', { id: projectId });
    return { project, actorUserId: null, actorApiKeyId: apiKey.id };
  }

  const user = ctx.get('user');
  if (!user) throw new AppError({ code: 'auth:no_user', message: 'Authentication required.' });
  const project = await prisma.project.findFirst({
    where: {
      id: projectId,
      organization: { members: { some: { userId: user.id, user: { suspendedAt: null } } } },
    },
    select: {
      id: true,
      organizationId: true,
      config: true,
      organization: {
        select: { metadata: true, members: { where: { userId: user.id }, take: 1, select: { role: true } } },
      },
    },
  });
  if (!project) throw notFound('project', { id: projectId });
  const role = project.organization.members[0]?.role ?? '';
  if (intent === 'write' && !roleAtLeast(role, MemberRole.ADMIN)) {
    throw new AppError({ code: 'auth:insufficient_role', message: 'Project administrator access is required.' });
  }
  return { project, actorUserId: user.id, actorApiKeyId: null };
};

const workspaceAvailabilitySchema = z
  .object({ plan: z.string().max(40).default('free'), entitlements: z.record(z.string(), z.boolean()).default({}) })
  .passthrough();

const workspaceAvailability = (metadata: string | null): WorkspaceAvailability => {
  const parsed = workspaceAvailabilitySchema.safeParse(parseWorkspaceMetadata(metadata));
  return parsed.success ? { plan: parsed.data.plan, entitlements: parsed.data.entitlements } : { plan: 'free', entitlements: {} };
};

const addonError = (
  code: 'addon:not_found' | 'addon:unavailable' | 'addon:configuration_required' | 'addon:revision_conflict',
  message: string,
  details?: Record<string, unknown>,
) => new AppError({ code, message, details });

const definitionFor = (addonId: string) => {
  if (!isAddonId(addonId)) throw addonError('addon:not_found', 'Add-on not found.', { addonId });
  return ADDON_REGISTRY[addonId];
};

const parseStoredConfig = <Id extends AddonId>(addonId: Id, config: unknown) => {
  const parsed = addonConfigSchemas[addonId].safeParse(config);
  return parsed.success ? parsed.data : ADDON_REGISTRY[addonId].defaultConfig;
};

const validateConfig = <Id extends AddonId>(addonId: Id, config: unknown) => {
  const parsed = addonConfigSchemas[addonId].safeParse(config);
  if (!parsed.success) {
    throw new AppError({
      code: 'validation:failed',
      message: 'The add-on configuration is invalid.',
      details: { addonId, issues: parsed.error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message })) },
    });
  }
  return parsed.data;
};

const configurationComplete = (addonId: AddonId, config: Record<string, unknown>) =>
  !ADDON_REGISTRY[addonId].requiresConfiguration || z.string().trim().min(1).safeParse(config.urlTemplate).success;

const serializeAddon = (
  definition: AddonDefinition,
  row: { enabled: boolean; config: unknown; revision: number; updatedAt: Date } | undefined,
  availability: WorkspaceAvailability,
) => {
  const config = parseStoredConfig(definition.id, row?.config ?? definition.defaultConfig);
  const enabled = row?.enabled ?? definition.defaultEnabled;
  const available = addonAvailable(definition, availability);
  const status = !available ? 'unavailable' : !enabled ? 'inactive' : configurationComplete(definition.id, config) ? 'active' : 'needs_configuration';
  return {
    id: definition.id,
    group: definition.group,
    enabled,
    config,
    revision: row?.revision ?? 0,
    updatedAt: row?.updatedAt?.toISOString() ?? null,
    status,
    availability: { ...definition.availability, available, plan: availability.plan },
  } as const;
};

const listRows = async (projectId: string) =>
  prisma.projectAddon.findMany({
    where: { projectId },
    select: { key: true, enabled: true, config: true, revision: true, updatedAt: true },
  });

export const listProjectAddons = async (ctx: Context<HonoEnv>, projectId: string) => {
  const { project } = await authorizeProjectAddons(ctx, projectId, 'read');
  const rows = await listRows(projectId);
  const byId = new Map(rows.map((row) => [row.key, row]));
  const availability = workspaceAvailability(project.organization.metadata);
  return addonDefinitions.map((definition) => serializeAddon(definition, byId.get(definition.id), availability));
};

export const getProjectAddon = async (ctx: Context<HonoEnv>, projectId: string, addonId: string) => {
  const definition = definitionFor(addonId);
  const { project } = await authorizeProjectAddons(ctx, projectId, 'read');
  const row = await prisma.projectAddon.findUnique({
    where: { projectId_key: { projectId, key: definition.id } },
    select: { enabled: true, config: true, revision: true, updatedAt: true },
  });
  return serializeAddon(definition, row ?? undefined, workspaceAvailability(project.organization.metadata));
};

const assertAvailable = (addonId: AddonId, metadata: string | null) => {
  const availability = workspaceAvailability(metadata);
  if (!addonAvailable(ADDON_REGISTRY[addonId], availability)) {
    throw addonError('addon:unavailable', 'This add-on is not available for the project.', { addonId, plan: availability.plan });
  }
  return availability;
};

const assertRevision = (addonId: AddonId, expectedRevision: number, actualRevision: number) => {
  if (expectedRevision !== actualRevision) {
    throw addonError('addon:revision_conflict', 'The add-on changed since it was loaded. Refresh and try again.', {
      addonId,
      expectedRevision,
      actualRevision,
    });
  }
};

const projectRowsForProjection = async (tx: Prisma.TransactionClient, projectId: string) => {
  const rows = await tx.projectAddon.findMany({ where: { projectId }, select: { key: true, enabled: true, config: true } });
  return rows.flatMap((row) => (isAddonId(row.key) ? [{ key: row.key, enabled: row.enabled, config: parseStoredConfig(row.key, row.config) }] : []));
};

const lockProjectAddonMutations = async (tx: Prisma.TransactionClient, organizationId: string, projectId: string) => {
  const rows = await tx.$queryRaw<Array<{ id: string }>>(
    Prisma.sql`SELECT "id" FROM "project" WHERE "id" = ${projectId} AND "organizationId" = ${organizationId} FOR UPDATE`,
  );
  if (!rows[0]) throw notFound('project', { id: projectId });
};

const createAddonRow = async (
  tx: Prisma.TransactionClient,
  data: { projectId: string; key: AddonId; enabled: boolean; config: Prisma.InputJsonValue; revision: number },
) => {
  try {
    return await tx.projectAddon.create({ data });
  } catch (error) {
    if (z.object({ code: z.literal('P2002') }).safeParse(error).success) {
      throw addonError('addon:revision_conflict', 'The add-on changed since it was loaded. Refresh and try again.', {
        addonId: data.key,
        expectedRevision: 0,
      });
    }
    throw error;
  }
};

const updateProjection = async (tx: Prisma.TransactionClient, organizationId: string, projectId: string) => {
  const rows = await projectRowsForProjection(tx, projectId);
  await mutateProjectConfig(tx, organizationId, projectId, (current) => projectConfigWithAddons(current, rows));
};

export const updateProjectAddon = async (ctx: Context<HonoEnv>, projectId: string, addonId: string, input: UpdateProjectAddonBody) => {
  const definition = definitionFor(addonId);
  const authorization = await authorizeProjectAddons(ctx, projectId, 'write');
  const availability = assertAvailable(definition.id, authorization.project.organization.metadata);
  const config = validateConfig(definition.id, input.config);
  const row = await prisma.$transaction(async (tx) => {
    await lockProjectAddonMutations(tx, authorization.project.organizationId, projectId);
    const current = await tx.projectAddon.findUnique({ where: { projectId_key: { projectId, key: definition.id } } });
    assertRevision(definition.id, input.expectedRevision, current?.revision ?? 0);
    const revision = (current?.revision ?? 0) + 1;
    const updated = current
      ? await tx.projectAddon.updateManyAndReturn({
          where: { id: current.id, revision: input.expectedRevision },
          data: { config: config as Prisma.InputJsonValue, revision: { increment: 1 } },
        })
      : [];
    if (current && !updated[0]) {
      throw addonError('addon:revision_conflict', 'The add-on changed since it was loaded. Refresh and try again.', {
        addonId: definition.id,
        expectedRevision: input.expectedRevision,
      });
    }
    const next =
      updated[0] ??
      (await createAddonRow(tx, {
        projectId,
        key: definition.id,
        enabled: definition.defaultEnabled,
        config: config as Prisma.InputJsonValue,
        revision,
      }));
    await tx.projectAddonAuditEvent.create({
      data: {
        projectId,
        addonKey: definition.id,
        actorUserId: authorization.actorUserId,
        actorApiKeyId: authorization.actorApiKeyId,
        action: 'configured',
        previousEnabled: current?.enabled ?? null,
        nextEnabled: next.enabled,
        ...(current ? { previousConfig: parseStoredConfig(definition.id, current.config) as Prisma.InputJsonValue } : {}),
        nextConfig: parseStoredConfig(definition.id, next.config) as Prisma.InputJsonValue,
        revision,
      },
    });
    await updateProjection(tx, authorization.project.organizationId, projectId);
    return next;
  });
  return serializeAddon(definition, row, availability);
};

const setProjectAddonEnabled = async (ctx: Context<HonoEnv>, projectId: string, addonId: string, input: MutateProjectAddonBody, enabled: boolean) => {
  const definition = definitionFor(addonId);
  const authorization = await authorizeProjectAddons(ctx, projectId, 'write');
  const availability = enabled
    ? assertAvailable(definition.id, authorization.project.organization.metadata)
    : workspaceAvailability(authorization.project.organization.metadata);
  const row = await prisma.$transaction(async (tx) => {
    await lockProjectAddonMutations(tx, authorization.project.organizationId, projectId);
    const current = await tx.projectAddon.findUnique({ where: { projectId_key: { projectId, key: definition.id } } });
    assertRevision(definition.id, input.expectedRevision, current?.revision ?? 0);
    const currentEnabled = current?.enabled ?? definition.defaultEnabled;
    const currentConfig = parseStoredConfig(definition.id, current?.config ?? definition.defaultConfig);
    if (enabled && !configurationComplete(definition.id, currentConfig)) {
      throw addonError('addon:configuration_required', 'Configure this add-on before enabling it.', { addonId: definition.id });
    }
    if (currentEnabled === enabled) return current;
    const revision = (current?.revision ?? 0) + 1;
    const updated = current
      ? await tx.projectAddon.updateManyAndReturn({
          where: { id: current.id, revision: input.expectedRevision },
          data: { enabled, revision: { increment: 1 } },
        })
      : [];
    if (current && !updated[0]) {
      throw addonError('addon:revision_conflict', 'The add-on changed since it was loaded. Refresh and try again.', {
        addonId: definition.id,
        expectedRevision: input.expectedRevision,
      });
    }
    const next =
      updated[0] ??
      (await createAddonRow(tx, {
        projectId,
        key: definition.id,
        enabled,
        config: currentConfig as Prisma.InputJsonValue,
        revision,
      }));
    await tx.projectAddonAuditEvent.create({
      data: {
        projectId,
        addonKey: definition.id,
        actorUserId: authorization.actorUserId,
        actorApiKeyId: authorization.actorApiKeyId,
        action: enabled ? 'activated' : 'deactivated',
        previousEnabled: currentEnabled,
        nextEnabled: enabled,
        previousConfig: currentConfig as Prisma.InputJsonValue,
        nextConfig: parseStoredConfig(definition.id, next.config) as Prisma.InputJsonValue,
        revision,
      },
    });
    await updateProjection(tx, authorization.project.organizationId, projectId);
    return next;
  });
  return serializeAddon(definition, row ?? undefined, availability);
};

export const activateProjectAddon = (ctx: Context<HonoEnv>, projectId: string, addonId: string, input: MutateProjectAddonBody) =>
  setProjectAddonEnabled(ctx, projectId, addonId, input, true);

export const deactivateProjectAddon = (ctx: Context<HonoEnv>, projectId: string, addonId: string, input: MutateProjectAddonBody) =>
  setProjectAddonEnabled(ctx, projectId, addonId, input, false);

export const listProjectAddonAuditEvents = async (ctx: Context<HonoEnv>, projectId: string, query: ListProjectAddonAuditQuery) => {
  await authorizeProjectAddons(ctx, projectId, 'read');
  if (query.cursor) {
    const cursor = await prisma.projectAddonAuditEvent.findFirst({
      where: { id: query.cursor, projectId, ...(query.addonId ? { addonKey: query.addonId } : {}) },
      select: { id: true },
    });
    if (!cursor) throw notFound('add-on audit event', { id: query.cursor });
  }
  const events = await prisma.projectAddonAuditEvent.findMany({
    where: { projectId, ...(query.addonId ? { addonKey: query.addonId } : {}) },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: query.limit + 1,
    ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
    select: {
      id: true,
      addonKey: true,
      action: true,
      previousEnabled: true,
      nextEnabled: true,
      previousConfig: true,
      nextConfig: true,
      revision: true,
      createdAt: true,
    },
  });
  const hasMore = events.length > query.limit;
  const items = hasMore ? events.slice(0, query.limit) : events;
  return {
    items: items.flatMap((event) => {
      const action = addonAuditActionSchema.safeParse(event.action);
      return action.success ? [{ ...event, action: action.data, createdAt: event.createdAt.toISOString() }] : [];
    }),
    nextCursor: hasMore ? (items.at(-1)?.id ?? null) : null,
  };
};
