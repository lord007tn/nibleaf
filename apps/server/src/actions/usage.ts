import { keys as clickHouseKeys, queryUsageMeterTotals, UsageHistoryUnavailableError, type UsageMeterTotal } from '@nibleaf/clickhouse';
import { Prisma, prisma } from '@nibleaf/database';
import { MemberRole } from '@nibleaf/shared/constants';
import { DEFAULT_PLAN_KEY, evaluateCapability, resolveEffectivePlan } from '@nibleaf/shared/plan-policy';
import {
  capabilityKeySchema,
  evaluateLimit,
  type MeterKey,
  type MeterReading,
  meterKeySchema,
  meterKeys,
  planKeySchema,
  utcBillingPeriod,
} from '@nibleaf/usage';
import type { Context } from 'hono';
import { z } from 'zod';
import { AppError, forbidden, notFound } from '@/errors';
import type { HonoEnv } from '@/lib/hono/context';
import { assertProjectAccess, assertProjectInOrg } from './projects';

/** Why a meter has no number. The UI names the cause; "Unknown" is never shown
 *  without one (production audit WORKSPACE-19). */
export type UsageUnavailableReason =
  | 'metering_disabled'
  | 'query_failed'
  | 'delayed'
  | 'catching_up'
  | 'tokens_incomplete'
  | 'not_measured'
  | 'seats_unavailable';

type SnapshotMeterKey = 'editor_seat' | 'asset_storage_byte' | 'custom_domain' | 'published_page';
type SummaryMeterKey = SnapshotMeterKey | MeterKey;

const snapshotMeters = ['editor_seat', 'asset_storage_byte', 'custom_domain', 'published_page'] as const satisfies readonly SnapshotMeterKey[];
const allMeterKeys: readonly SummaryMeterKey[] = [...snapshotMeters, ...meterKeys];

const units: Record<SummaryMeterKey, 'byte' | 'count' | 'token'> = {
  editor_seat: 'count',
  asset_storage_byte: 'byte',
  custom_domain: 'count',
  published_page: 'count',
  public_page_view: 'count',
  search_query: 'count',
  ai_answer: 'count',
  ai_input_token: 'token',
  ai_output_token: 'token',
  embedded_chunk: 'count',
  indexed_content_byte: 'byte',
  build: 'count',
};

const currentUtcPeriod = () => utcBillingPeriod(new Date().toISOString());
const USAGE_PENDING_STALE_MS = 24 * 60 * 60 * 1000;

const parsePeriod = (period?: { periodStart?: string; periodEndExclusive?: string }) => {
  if (!period?.periodStart && !period?.periodEndExclusive) return currentUtcPeriod();
  const start = new Date(period.periodStart ?? '');
  const end = new Date(period.periodEndExclusive ?? '');
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || start >= end || end.getTime() - start.getTime() > 400 * 86_400_000) {
    throw new AppError({ code: 'usage:invalid_period', message: 'Usage periods must be valid half-open UTC ranges of at most 400 days.' });
  }
  return { start: start.toISOString(), endExclusive: end.toISOString() };
};

const resolveProjectAuthorization = async (ctx: Context<HonoEnv>, projectId: string) => {
  const apiKey = ctx.get('apiKey');
  if (apiKey) {
    if (apiKey.projectId !== projectId) throw notFound('project', { id: projectId });
    const project = await prisma.project.findUnique({ where: { id: projectId }, select: { id: true, organizationId: true, dataTenantId: true } });
    if (!project) throw notFound('project', { id: projectId });
    return { organizationId: project.organizationId, dataTenantId: project.dataTenantId, role: null, apiKey };
  }
  const user = ctx.get('user');
  if (!user) throw new AppError({ code: 'auth:no_user', message: 'Authentication required.' });
  const authorized = await assertProjectAccess(user.id, projectId);
  return { organizationId: authorized.organizationId, dataTenantId: authorized.project.dataTenantId, role: authorized.role, apiKey: null };
};

const resolveProjectScope = async (ctx: Context<HonoEnv>, projectId: string, requiredScope: string) => {
  const authorized = await resolveProjectAuthorization(ctx, projectId);
  if (authorized.apiKey && !authorized.apiKey.scopes.includes(requiredScope)) {
    throw new AppError({ code: 'auth:insufficient_scope', message: 'The credential lacks the required usage scope.' });
  }
  return authorized;
};

const planSelect = {
  key: true,
  active: true,
  meters: {
    select: { behavior: true, limit: true, warningRatio: true, meter: { select: { key: true, unit: true, active: true } } },
  },
  entitlements: {
    select: { capabilityKey: true, enabled: true, limit: true, behavior: true, meter: { select: { key: true, active: true } } },
  },
} satisfies Prisma.UsagePlanSelect;

const getPlanConfiguration = async (organizationId: string) =>
  prisma.organizationUsagePlan.findUnique({
    where: { organizationId },
    select: { status: true, effectiveAt: true, expiresAt: true, plan: { select: planSelect } },
  });

/**
 * The plan that governs an organization, through the shared resolver
 * (`@nibleaf/shared/plan-policy`) that publish, public delivery, the worker,
 * settings and MCP all use: the active assignment, else the canonical free
 * plan as configured, else none. `source` says which; `reason` why the
 * assignment itself does not apply.
 */
const getEffectivePlanConfiguration = async (organizationId: string, now = new Date()) => {
  const [assigned, defaultPlan] = await Promise.all([
    getPlanConfiguration(organizationId),
    prisma.usagePlan.findUnique({ where: { key: DEFAULT_PLAN_KEY }, select: planSelect }),
  ]);
  const effective = resolveEffectivePlan(assigned, defaultPlan, now);
  const reason = effective.assignment === 'active' ? null : effective.assignment;
  if (!effective.plan) return { availability: 'unavailable' as const, configured: null, effective, reason, source: effective.source };
  return { availability: 'complete' as const, configured: { plan: effective.plan }, effective, reason, source: effective.source };
};

/** One org seat per active author, even when they hold grants on many sites:
 * org Owners and Admins, plus Members holding an Admin or Editor grant on any
 * website. Viewer-only and grantless members, and suspended or banned
 * accounts, are not seats. */
export const countEditorSeats = async (organizationId: string): Promise<bigint | null> => {
  const rows = await prisma.$queryRaw<Array<{ quantity: bigint }>>(
    Prisma.sql`SELECT COUNT(DISTINCT member."userId")::bigint AS quantity FROM member
      JOIN "user" account ON account.id = member."userId"
      WHERE member."organizationId" = ${organizationId}
      AND (member."orgRole" IN ('owner','admin') OR EXISTS (
        SELECT 1 FROM project_member grant_row WHERE grant_row."organizationId" = member."organizationId"
        AND grant_row."userId" = member."userId" AND grant_row.role IN ('admin','member')))
      AND account."suspendedAt" IS NULL AND account.banned = false`,
  );
  return rows[0]?.quantity ?? null;
};

export const canReadOrganizationBilling = async (userId: string, organizationId: string) => {
  const membership = await prisma.member.findUnique({
    where: { organizationId_userId: { organizationId, userId } },
    select: { orgRole: true },
  });
  return membership?.orgRole === 'owner' || membership?.orgRole === 'admin';
};

const getSnapshotQuantities = async (organizationId: string, projectId: string, includeBilling: boolean) => {
  const [seats, assets, domains, deployment] = await Promise.all([
    includeBilling ? countEditorSeats(organizationId) : Promise.resolve(null),
    prisma.$queryRaw<Array<{ quantity: bigint }>>(
      Prisma.sql`SELECT COALESCE(SUM("size"), 0)::bigint AS quantity FROM "asset" WHERE "projectId" = ${projectId}`,
    ),
    prisma.$queryRaw<Array<{ quantity: bigint }>>(
      Prisma.sql`SELECT COUNT(*)::bigint AS quantity FROM "domain"
        WHERE "projectId" = ${projectId} AND "verified" = true AND "dnsStatus" = 'VERIFIED' AND "sslStatus" = 'ACTIVE'`,
    ),
    prisma.deployment.findFirst({
      where: { projectId, status: 'READY', snapshot: { not: Prisma.DbNull } },
      orderBy: { version: 'desc' },
      select: { pagesCount: true },
    }),
  ]);
  return new Map<SummaryMeterKey, string | null>([
    ['editor_seat', seats?.toString() ?? null],
    ['asset_storage_byte', assets[0]?.quantity.toString() ?? null],
    ['custom_domain', domains[0]?.quantity.toString() ?? null],
    ['published_page', deployment ? String(deployment.pagesCount) : null],
  ]);
};

const getProjectUsageSummaryForOrganization = async (
  organizationId: string,
  projectId: string,
  period?: { periodStart?: string; periodEndExclusive?: string },
  includeBilling = true,
) => {
  const range = parsePeriod(period);
  const project = await prisma.project.findUnique({ where: { id: projectId }, select: { dataTenantId: true } });
  if (!project) throw notFound('project', { id: projectId });
  const dataTenantId = project.dataTenantId;
  const [planState, snapshots, pendingCheckpoint] = await Promise.all([
    includeBilling
      ? getEffectivePlanConfiguration(organizationId)
      : Promise.resolve({ configured: null, availability: 'unavailable' as const, reason: 'missing' as const, source: 'none' as const }),
    getSnapshotQuantities(organizationId, projectId, includeBilling),
    prisma.usageIngestCheckpoint.findFirst({
      where: {
        partitionId: dataTenantId,
        projectId,
        writtenAt: null,
        firstOccurredAt: { lt: new Date(range.endExclusive) },
        lastOccurredAt: { gte: new Date(range.start) },
      },
      orderBy: { enqueuedAt: 'asc' },
      select: { enqueuedAt: true },
    }),
  ]);
  const plan = planState.configured;
  let highVolume = new Map<MeterKey, UsageMeterTotal>();
  let highVolumeAvailability: MeterReading['availability'] = 'unavailable';
  let highVolumeReason: UsageUnavailableReason | null = 'metering_disabled';
  if (clickHouseKeys().ANALYTICS_MODE === 'clickhouse') {
    try {
      highVolume = new Map((await queryUsageMeterTotals(dataTenantId, projectId, range.start, range.endExclusive)).map((row) => [row.meterKey, row]));
      const stale = pendingCheckpoint ? Date.now() - pendingCheckpoint.enqueuedAt.getTime() > USAGE_PENDING_STALE_MS : false;
      highVolumeAvailability = pendingCheckpoint ? (stale ? 'unavailable' : 'partial') : 'complete';
      highVolumeReason = pendingCheckpoint ? (stale ? 'delayed' : 'catching_up') : null;
    } catch {
      highVolumeAvailability = 'unavailable';
      highVolumeReason = 'query_failed';
    }
  }

  const configured = new Map(plan?.plan.meters.filter((item) => item.meter.active).map((item) => [item.meter.key, item]));
  const answered = BigInt(highVolume.get('ai_answer')?.eventCount ?? '0');
  const tokenCompleteness = (key: 'ai_input_token' | 'ai_output_token') => {
    if (highVolumeAvailability !== 'complete') return highVolumeAvailability;
    return BigInt(highVolume.get(key)?.eventCount ?? '0') < answered ? ('partial' as const) : ('complete' as const);
  };

  const meters = allMeterKeys
    .filter((key) => includeBilling || key !== 'editor_seat')
    .map((key) => {
      const planMeter = configured.get(key);
      const snapshotValue = snapshots.get(key);
      const eventMeter = meterKeySchema.safeParse(key);
      const availability = snapshots.has(key)
        ? snapshotValue === null
          ? ('unavailable' as const)
          : ('complete' as const)
        : key === 'ai_input_token' || key === 'ai_output_token'
          ? tokenCompleteness(key)
          : highVolumeAvailability;
      const quantity =
        availability === 'unavailable' || availability === 'partial'
          ? null
          : (snapshotValue ?? (eventMeter.success ? highVolume.get(eventMeter.data)?.quantity : null) ?? '0');
      const reading: MeterReading = {
        meterKey: key,
        quantity,
        limit: planMeter?.limit?.toString() ?? null,
        availability,
        behavior: planMeter?.behavior === 'block' || planMeter?.behavior === 'warn' ? planMeter.behavior : 'observe',
        enforcement: 'advisory',
        periodStart: snapshots.has(key) ? null : range.start,
        periodEndExclusive: snapshots.has(key) ? null : range.endExclusive,
      };
      const unavailableReason: UsageUnavailableReason | null =
        availability === 'complete'
          ? null
          : snapshots.has(key)
            ? 'not_measured'
            : (key === 'ai_input_token' || key === 'ai_output_token') && highVolumeAvailability === 'complete'
              ? 'tokens_incomplete'
              : highVolumeReason;
      return { key, unit: units[key], ...reading, unavailableReason, ...evaluateLimit(reading, (planMeter?.warningRatio ?? 80) / 100) };
    });

  return {
    schemaVersion: 1 as const,
    projectId,
    period: { start: range.start, endExclusive: range.endExclusive, timezone: 'UTC' as const },
    availability: meters.every((meter) => meter.availability === 'complete')
      ? ('complete' as const)
      : meters.every((meter) => meter.availability === 'unavailable')
        ? ('unavailable' as const)
        : ('partial' as const),
    incomplete: meters.some((meter) => meter.availability !== 'complete'),
    plan: includeBilling
      ? {
          key: plan?.plan.key ?? null,
          // `default`: no active assignment; the org runs on the free plan.
          status:
            planState.source === 'assignment'
              ? ('active' as const)
              : planState.source === 'default'
                ? ('default' as const)
                : planState.reason === 'inactive'
                  ? ('inactive' as const)
                  : ('unknown' as const),
        }
      : undefined,
    meters: includeBilling ? meters : meters.map((meter) => ({ ...meter, limit: undefined, behavior: undefined, enforcement: undefined })),
    generatedAt: new Date().toISOString(),
  };
};

/** Public shared action for UI/MCP. Project ownership is derived from the
 * trusted principal; organization id is never caller authority. */
export const getProjectUsageSummary = async (
  ctx: Context<HonoEnv>,
  projectId: string,
  period?: { periodStart?: string; periodEndExclusive?: string },
) => {
  const { organizationId } = await resolveProjectScope(ctx, projectId, 'usage:read');
  const user = ctx.get('user');
  const includeBilling = user ? await canReadOrganizationBilling(user.id, organizationId) : false;
  return getProjectUsageSummaryForOrganization(organizationId, projectId, period, includeBilling);
};

/** Org-only billing DTO. Callers must supply the signed-in user, never a role. */
export const getOrganizationUsageSummary = async (
  userId: string,
  organizationId: string,
  period?: { periodStart?: string; periodEndExclusive?: string },
) => {
  if (!(await canReadOrganizationBilling(userId, organizationId))) throw forbidden('Organization billing requires an owner or admin role.');
  const range = parsePeriod(period);
  const [projects, seats, planState] = await Promise.all([
    prisma.project.findMany({ where: { organizationId }, select: { id: true, name: true }, orderBy: { id: 'asc' } }),
    countEditorSeats(organizationId),
    getEffectivePlanConfiguration(organizationId),
  ]);
  const websites: Array<Awaited<ReturnType<typeof getProjectUsageSummaryForOrganization>> & { name: string }> = [];
  // Bound database/ClickHouse fanout for large organizations.
  for (const project of projects)
    websites.push({ ...(await getProjectUsageSummaryForOrganization(organizationId, project.id, period, false)), name: project.name });
  const quantities = new Map<string, string | null>([['editor_seat', seats?.toString() ?? null]]);
  // An org total is unknown when any website's reading is; it carries that website's reason.
  const reasons = new Map<string, UsageUnavailableReason | null>([['editor_seat', seats === null ? 'seats_unavailable' : null]]);
  for (const key of allMeterKeys.filter((key) => key !== 'editor_seat')) {
    const readings = websites.map((site) => site.meters.find((meter) => meter.key === key));
    const missing = readings.find((meter) => meter?.availability !== 'complete' || meter.quantity === null);
    quantities.set(key, missing ? null : readings.reduce((sum, meter) => sum + BigInt(meter?.quantity ?? '0'), 0n).toString());
    reasons.set(key, missing ? (missing.unavailableReason ?? 'not_measured') : null);
  }
  const meters = allMeterKeys.map((key) => {
    const configured = planState.configured?.plan.meters.find((item) => item.meter.key === key && item.meter.active);
    const quantity = quantities.get(key) ?? null;
    const reading: MeterReading = {
      meterKey: key,
      quantity,
      limit: configured?.limit?.toString() ?? null,
      availability: quantity === null ? 'unavailable' : 'complete',
      behavior: configured?.behavior === 'block' || configured?.behavior === 'warn' ? configured.behavior : 'observe',
      enforcement: 'advisory',
      periodStart: range.start,
      periodEndExclusive: range.endExclusive,
    };
    return {
      key,
      unit: units[key],
      ...reading,
      unavailableReason: quantity === null ? (reasons.get(key) ?? 'not_measured') : null,
      ...evaluateLimit(reading, (configured?.warningRatio ?? 80) / 100),
    };
  });
  return {
    schemaVersion: 1 as const,
    organizationId,
    period: range,
    websites,
    meters,
    plan: { key: planState.configured?.plan.key ?? null, availability: planState.availability },
    incomplete: seats === null || websites.some((site) => site.incomplete),
  };
};

export const getProjectEntitlements = async (ctx: Context<HonoEnv>, projectId: string) => {
  const { organizationId } = await resolveProjectScope(ctx, projectId, 'entitlements:read');
  const planState = await getEffectivePlanConfiguration(organizationId);
  const configured = planState.configured;
  const hasInactiveEntitlementMeter = configured?.plan.entitlements.some((item) => item.meter && !item.meter.active) ?? false;
  return {
    schemaVersion: 1 as const,
    projectId,
    planKey: configured?.plan.key ?? null,
    availability: planState.availability === 'complete' && hasInactiveEntitlementMeter ? ('partial' as const) : planState.availability,
    entitlements:
      configured?.plan.entitlements.map((item) => ({
        capabilityKey: item.capabilityKey,
        enabled: item.enabled && (item.meter?.active ?? true),
        availability: item.meter && !item.meter.active ? ('unavailable' as const) : ('complete' as const),
        limit: item.meter && !item.meter.active ? null : (item.limit?.toString() ?? null),
        meterKey: item.meter?.active ? item.meter.key : null,
        behavior: item.behavior === 'block' || item.behavior === 'warn' ? item.behavior : ('observe' as const),
        enforcement: 'advisory' as const,
      })) ?? [],
  };
};

export const checkProjectEntitlement = async (ctx: Context<HonoEnv>, projectId: string, capabilityKey: string) => {
  if (!capabilityKeySchema.safeParse(capabilityKey).success) {
    throw new AppError({ code: 'validation:failed', message: 'Capability key is invalid.' });
  }
  const summary = await getProjectEntitlements(ctx, projectId);
  if (summary.availability === 'unavailable')
    throw new AppError({ code: 'entitlement:unknown', message: 'Entitlement configuration is unavailable.' });
  const entitlement = summary.entitlements.find((item) => item.capabilityKey === capabilityKey);
  if (!entitlement) throw new AppError({ code: 'entitlement:unknown', message: 'Entitlement is not configured.' });
  if (entitlement.availability === 'unavailable') {
    throw new AppError({ code: 'entitlement:unknown', message: 'The entitlement meter is unavailable.' });
  }
  if (!entitlement.enabled) throw new AppError({ code: 'entitlement:disabled', message: 'This capability is not enabled.' });
  return entitlement;
};

const capabilityInputSchema = z.object({
  capabilityKey: capabilityKeySchema,
  eligiblePlanKeys: z.array(planKeySchema).max(50),
});
export const resolveProjectCapability = async (
  ctx: Context<HonoEnv>,
  projectId: string,
  input: { capabilityKey: string; eligiblePlanKeys: readonly string[] },
) => {
  const inputResult = capabilityInputSchema.safeParse({ ...input, eligiblePlanKeys: [...input.eligiblePlanKeys] });
  if (!inputResult.success) throw new AppError({ code: 'validation:failed', message: 'Capability policy is invalid.' });
  const parsed = inputResult.data;
  const { organizationId } = await resolveProjectAuthorization(ctx, projectId);
  const planState = await getEffectivePlanConfiguration(organizationId);
  const result = evaluateCapability(planState.effective, { capabilityKey: parsed.capabilityKey, eligiblePlanKeys: parsed.eligiblePlanKeys });
  const entitlement = result.availability === 'complete' ? result.entitlement : null;
  return {
    schemaVersion: 1 as const,
    projectId,
    capabilityKey: parsed.capabilityKey,
    availability: result.availability,
    decision: result.decision,
    planKey: result.planKey,
    source: planState.source === 'none' ? null : ('plan' as const),
    limit: entitlement?.limit?.toString() ?? null,
    meterKey: entitlement?.meter?.key ?? null,
    behavior: entitlement?.behavior === 'block' || entitlement?.behavior === 'warn' ? entitlement.behavior : ('observe' as const),
    enforcement: 'advisory' as const,
  };
};

export const exportProjectUsage = async (ctx: Context<HonoEnv>, projectId: string, period: { periodStart: string; periodEndExclusive: string }) => {
  const { dataTenantId, role } = await resolveProjectScope(ctx, projectId, 'usage:export');
  if (role !== MemberRole.OWNER && role !== MemberRole.ADMIN) throw forbidden('Usage export requires an owner or admin role.');
  const range = parsePeriod(period);
  if (clickHouseKeys().ANALYTICS_MODE !== 'clickhouse') throw new AppError({ code: 'usage:unavailable', message: 'Usage facts are unavailable.' });
  try {
    const pendingCheckpoint = await prisma.usageIngestCheckpoint.findFirst({
      where: {
        partitionId: dataTenantId,
        projectId,
        writtenAt: null,
        firstOccurredAt: { lt: new Date(range.endExclusive) },
        lastOccurredAt: { gte: new Date(range.start) },
      },
      select: { id: true },
    });
    if (pendingCheckpoint) throw new AppError({ code: 'usage:export_not_ready', message: 'Usage ingestion is pending.' });
    const meters = await queryUsageMeterTotals(dataTenantId, projectId, range.start, range.endExclusive);
    if (meters.some((meter) => meter.lateEventCount !== '0'))
      throw new AppError({ code: 'usage:export_not_ready', message: 'Late usage is pending reconciliation.' });
    return {
      schemaVersion: 1 as const,
      projectId,
      period: { start: range.start, endExclusive: range.endExclusive, timezone: 'UTC' as const },
      meters: meters.map(({ meterKey, quantity }) => ({ key: meterKey, quantity })),
    };
  } catch (error) {
    if (error instanceof AppError) throw error;
    if (error instanceof UsageHistoryUnavailableError) {
      throw new AppError({ code: 'usage:export_not_ready', message: 'Usage reconciliation is not complete.' });
    }
    throw new AppError({ code: 'usage:unavailable', message: 'Usage facts are unavailable.', cause: error });
  }
};

/** Internal compatibility projection for the platform-admin surface. */
export const getProjectUsage = async (organizationId: string, projectId: string) => {
  await assertProjectInOrg(organizationId, projectId);
  const now = new Date();
  const rollingStart = new Date(now.getTime() - 30 * 86_400_000);
  const summary = await getProjectUsageSummaryForOrganization(organizationId, projectId, {
    periodStart: rollingStart.toISOString(),
    periodEndExclusive: now.toISOString(),
  });
  const month = utcBillingPeriod(now.toISOString());
  const value = (key: SummaryMeterKey) => summary.meters.find((meter) => meter.key === key)?.quantity;
  const boundedNumber = (quantity: string | null | undefined) => {
    if (quantity === null || quantity === undefined) return null;
    const exact = BigInt(quantity);
    if (exact > BigInt(Number.MAX_SAFE_INTEGER) || exact < BigInt(Number.MIN_SAFE_INTEGER)) {
      throw new AppError({ code: 'usage:unavailable', message: 'Legacy usage projection cannot safely represent this exact quantity.' });
    }
    return Number(exact);
  };
  const [languages, deployments, latestDeployment, assets] = await Promise.all([
    prisma.language.count({ where: { projectId } }),
    prisma.deployment.count({ where: { projectId, createdAt: { gte: new Date(month.start), lt: new Date(month.endExclusive) } } }),
    prisma.deployment.findFirst({
      where: { projectId, status: 'READY' },
      orderBy: { version: 'desc' },
      select: { version: true, completedAt: true, createdAt: true },
    }),
    prisma.asset.count({ where: { projectId } }),
  ]);
  return {
    pages: boundedNumber(value('published_page')) ?? 0,
    languages,
    members: boundedNumber(value('editor_seat')) ?? 0,
    deployments: {
      thisMonth: deployments,
      latestVersion: latestDeployment?.version ?? null,
      lastPublishedAt: (latestDeployment?.completedAt ?? latestDeployment?.createdAt)?.toISOString() ?? null,
    },
    traffic: { pageviews30d: boundedNumber(value('public_page_view')), searches30d: boundedNumber(value('search_query')) },
    storage: { bytes: boundedNumber(value('asset_storage_byte')) ?? 0, assets },
  };
};
