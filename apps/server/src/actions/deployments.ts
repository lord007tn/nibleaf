import { createJob, QueueNames } from '@plume/bullmq';
import { Prisma, prisma } from '@plume/database';
import type { SiteSnapshot, SnapshotPage } from '@plume/shared/site';
import type { CreateDeploymentBody } from '@plume/validators';
import { badRequest, notFound } from '@/errors';
import { assertProjectInOrg } from './projects';

export const listDeployments = (projectId: string) => prisma.deployment.findMany({ where: { projectId }, orderBy: { version: 'desc' }, take: 50 });

export const getDeployment = async (projectId: string, id: string) => {
  const deployment = await prisma.deployment.findFirst({ where: { id, projectId } });
  if (!deployment) {
    throw notFound('deployment', { id });
  }
  return deployment;
};

export const getLatestReadyDeployment = (projectId: string) =>
  prisma.deployment.findFirst({ where: { projectId, status: 'READY' }, orderBy: { version: 'desc' } });

/** One page's status relative to the last published snapshot. */
export interface PendingChange {
  id: string;
  title: string;
  path: string;
  languageCode: string;
  kind: 'PAGE' | 'GROUP';
  status: 'added' | 'modified' | 'removed';
}

/** What will change on the next publish, vs. the last READY deployment. */
export interface PendingChanges {
  /** false = never published, so everything counts as new. */
  hasBaseline: boolean;
  lastVersion: number | null;
  lastPublishedAt: string | null;
  changes: PendingChange[];
}

/** Stable JSON compare (key-order independent) for the page `config` blob. */
function stableEqual(a: unknown, b: unknown): boolean {
  const norm = (v: unknown): unknown => {
    if (v === null || v === undefined) {
      return null;
    }
    if (Array.isArray(v)) {
      return v.map(norm);
    }
    if (typeof v === 'object') {
      return Object.fromEntries(
        Object.entries(v as Record<string, unknown>)
          .filter(([, val]) => val !== undefined)
          .sort(([x], [y]) => x.localeCompare(y))
          .map(([k, val]) => [k, norm(val)]),
      );
    }
    return v;
  };
  return JSON.stringify(norm(a)) === JSON.stringify(norm(b));
}

/** A draft page differs from its published copy if any output-affecting field changed. */
function pageChanged(
  draft: {
    title: string;
    content: string;
    slug: string;
    path: string;
    icon: string | null;
    description: string | null;
    hidden: boolean;
    position: number;
    parentId: string | null;
    translationKey: string | null;
    config: unknown;
  },
  prev: SnapshotPage,
): boolean {
  return (
    draft.title !== prev.title ||
    draft.content !== prev.content ||
    draft.slug !== prev.slug ||
    draft.path !== prev.path ||
    (draft.icon ?? null) !== (prev.icon ?? null) ||
    (draft.description ?? null) !== (prev.description ?? null) ||
    draft.hidden !== prev.hidden ||
    draft.position !== prev.position ||
    (draft.parentId ?? null) !== (prev.parentId ?? null) ||
    (draft.translationKey ?? null) !== (prev.translationKey ?? null) ||
    !stableEqual(draft.config ?? null, prev.config ?? null)
  );
}

/**
 * Diff the current default-branch draft against the last published snapshot, so the
 * publish dialog can show exactly which pages will change (Mintlify-style). The live
 * site is built from the default branch only, so that's what we compare.
 */
export const getPendingChanges = async (projectId: string): Promise<PendingChanges> => {
  const latest = await getLatestReadyDeployment(projectId);
  const defaultBranch = await prisma.branch.findFirst({ where: { projectId, isDefault: true }, select: { id: true } });
  const pages = await prisma.page.findMany({
    where: { projectId, ...(defaultBranch ? { branchId: defaultBranch.id } : {}) },
    orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
    include: { language: { select: { code: true } } },
  });
  const current = pages.map(({ language, ...page }) => ({ ...page, languageCode: language?.code ?? '' }));

  const toChange = (p: (typeof current)[number], status: PendingChange['status']): PendingChange => ({
    id: p.id,
    title: p.title,
    path: p.path,
    languageCode: p.languageCode,
    kind: p.kind as 'PAGE' | 'GROUP',
    status,
  });

  // No baseline → first publish: every page is new.
  if (!latest?.snapshot) {
    return {
      hasBaseline: false,
      lastVersion: null,
      lastPublishedAt: null,
      changes: current.map((p) => toChange(p, 'added')),
    };
  }

  const snap = latest.snapshot as unknown as SiteSnapshot;
  const prevById = new Map((snap.pages ?? []).map((p) => [p.id, p]));
  const currentIds = new Set(current.map((p) => p.id));
  const changes: PendingChange[] = [];

  for (const p of current) {
    const prev = prevById.get(p.id);
    if (!prev) {
      changes.push(toChange(p, 'added'));
    } else if (pageChanged(p, prev)) {
      changes.push(toChange(p, 'modified'));
    }
  }
  for (const prev of snap.pages ?? []) {
    if (!currentIds.has(prev.id)) {
      changes.push({ id: prev.id, title: prev.title, path: prev.path, languageCode: prev.languageCode, kind: prev.kind, status: 'removed' });
    }
  }

  return {
    hasBaseline: true,
    lastVersion: latest.version,
    lastPublishedAt: latest.completedAt?.toISOString() ?? null,
    changes,
  };
};

const MAX_VERSION_RETRIES = 5;

/** Allocate the next version and create a deployment, retrying when a concurrent
 *  publish/rollback grabs the same version. `max(version)+1` then `create` is a
 *  read-then-write race; the `@@unique([projectId, version])` constraint turns a
 *  collision into a P2002 we recompute-and-retry instead of surfacing as a 500. */
async function createWithNextVersion<T>(projectId: string, build: (version: number) => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    const last = await prisma.deployment.aggregate({ where: { projectId }, _max: { version: true } });
    const version = (last._max.version ?? 0) + 1;
    try {
      return await build(version);
    } catch (err) {
      const isVersionConflict = err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002';
      if (isVersionConflict && attempt < MAX_VERSION_RETRIES - 1) {
        continue;
      }
      throw err;
    }
  }
}

/** Create a PENDING deployment and enqueue the publish job for the worker to build. */
export const createDeployment = async (organizationId: string, projectId: string, userId: string, body: CreateDeploymentBody) => {
  await assertProjectInOrg(organizationId, projectId);
  const deployment = await createWithNextVersion(projectId, (version) =>
    prisma.deployment.create({
      data: {
        projectId,
        version,
        status: 'PENDING',
        createdById: userId,
        ...(body.message ? { commitMessage: body.message } : {}),
      },
    }),
  );
  await createJob(QueueNames.PUBLISH, { name: 'publish-deployment', data: { deploymentId: deployment.id, projectId } });
  return deployment;
};

/** Re-publish a previous READY deployment's snapshot as a new deployment. */
export const rollbackDeployment = async (organizationId: string, projectId: string, deploymentId: string, userId: string) => {
  await assertProjectInOrg(organizationId, projectId);
  const target = await prisma.deployment.findFirst({ where: { id: deploymentId, projectId } });
  if (!target) {
    throw notFound('deployment', { id: deploymentId });
  }
  if (target.status !== 'READY' || !target.snapshot) {
    throw badRequest('Only a published deployment with a snapshot can be rolled back to.', { id: deploymentId });
  }
  return createWithNextVersion(projectId, (version) =>
    prisma.deployment.create({
      data: {
        projectId,
        version,
        status: 'READY',
        snapshot: target.snapshot as Prisma.InputJsonValue,
        pagesCount: target.pagesCount,
        commitMessage: `Rollback to v${target.version}`,
        createdById: userId,
        completedAt: new Date(),
      },
    }),
  );
};
