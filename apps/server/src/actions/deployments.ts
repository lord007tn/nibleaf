import { createJob, QueueNames } from '@nibleaf/bullmq';
import { Prisma, prisma } from '@nibleaf/database';
import { buildSnapshot, type SiteSnapshot, type SnapshotPage } from '@nibleaf/shared/site';
import type { CreateDeploymentBody } from '@nibleaf/validators';
import { diffLines } from 'diff';
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
export interface PendingChange extends DeploymentPageDiff {}

/** What will change on the next publish, vs. the last READY deployment. */
export interface PendingChanges {
  /** false = never published, so everything counts as new. */
  hasBaseline: boolean;
  lastVersion: number | null;
  lastPublishedAt: string | null;
  changes: PendingChange[];
}

export interface DeploymentDiffLine {
  type: 'added' | 'removed' | 'unchanged';
  text: string;
  oldLine: number | null;
  newLine: number | null;
}

export interface DeploymentPageDiff {
  id: string;
  title: string;
  path: string;
  languageCode: string;
  kind: 'PAGE' | 'GROUP';
  status: 'added' | 'modified' | 'removed';
  fields: string[];
  additions: number;
  deletions: number;
  lines: DeploymentDiffLine[];
  truncated: boolean;
}

export interface DeploymentDiff {
  deployment: Omit<Awaited<ReturnType<typeof getDeployment>>, 'snapshot'>;
  previousDeployment: Omit<Awaited<ReturnType<typeof getDeployment>>, 'snapshot'> | null;
  changes: DeploymentPageDiff[];
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

const MAX_DIFF_LINES = 500;

const splitDiffLines = (value: string): string[] => {
  if (!value) {
    return [];
  }
  const lines = value.split('\n');
  if (lines[lines.length - 1] === '') {
    lines.pop();
  }
  return lines;
};

const contentDiff = (before: string, after: string): Pick<DeploymentPageDiff, 'additions' | 'deletions' | 'lines' | 'truncated'> => {
  const lines: DeploymentDiffLine[] = [];
  let oldLine = 1;
  let newLine = 1;
  let additions = 0;
  let deletions = 0;
  let truncated = false;

  for (const part of diffLines(before, after)) {
    const type: DeploymentDiffLine['type'] = part.added ? 'added' : part.removed ? 'removed' : 'unchanged';
    for (const text of splitDiffLines(part.value)) {
      if (type === 'added') {
        additions += 1;
      }
      if (type === 'removed') {
        deletions += 1;
      }
      if (lines.length < MAX_DIFF_LINES) {
        lines.push({
          type,
          text,
          oldLine: type === 'added' ? null : oldLine,
          newLine: type === 'removed' ? null : newLine,
        });
      } else {
        truncated = true;
      }
      if (type !== 'added') {
        oldLine += 1;
      }
      if (type !== 'removed') {
        newLine += 1;
      }
    }
  }

  return { additions, deletions, lines, truncated };
};

const changedFields = (current: SnapshotPage, previous: SnapshotPage): string[] => {
  const fields: string[] = [];
  const compare: Array<[keyof SnapshotPage, string]> = [
    ['title', 'title'],
    ['slug', 'slug'],
    ['path', 'path'],
    ['icon', 'icon'],
    ['description', 'description'],
    ['hidden', 'visibility'],
    ['position', 'position'],
    ['parentId', 'parent'],
    ['translationKey', 'translation key'],
    ['kind', 'kind'],
    ['languageCode', 'language'],
  ];
  for (const [key, label] of compare) {
    if ((current[key] ?? null) !== (previous[key] ?? null)) {
      fields.push(label);
    }
  }
  if (!stableEqual(current.config ?? null, previous.config ?? null)) {
    fields.push('page settings');
  }
  if (current.content !== previous.content) {
    fields.push('content');
  }
  return fields;
};

const pageSummary = (page: SnapshotPage, status: DeploymentPageDiff['status'], previous?: SnapshotPage): DeploymentPageDiff => {
  const before = previous?.content ?? '';
  const after = status === 'removed' ? '' : page.content;
  const diff = contentDiff(before, after);
  return {
    id: page.id,
    title: page.title,
    path: page.path,
    languageCode: page.languageCode,
    kind: page.kind,
    status,
    fields: status === 'modified' && previous ? changedFields(page, previous) : ['content'],
    ...diff,
  };
};

const stripSnapshot = <T extends { snapshot: unknown }>(deployment: T): Omit<T, 'snapshot'> => {
  const { snapshot: _snapshot, ...rest } = deployment;
  return rest;
};

export const getDeploymentDiff = async (projectId: string, id: string): Promise<DeploymentDiff> => {
  const deployment = await getDeployment(projectId, id);
  if (deployment.status !== 'READY' || !deployment.snapshot) {
    throw badRequest('Only a published deployment with a snapshot has a diff.', { id });
  }
  const previousDeployment = await prisma.deployment.findFirst({
    where: { projectId, status: 'READY', version: { lt: deployment.version } },
    orderBy: { version: 'desc' },
  });

  const currentSnapshot = deployment.snapshot as unknown as SiteSnapshot;
  const previousSnapshot = previousDeployment?.snapshot ? (previousDeployment.snapshot as unknown as SiteSnapshot) : null;
  const previousById = new Map((previousSnapshot?.pages ?? []).map((page) => [page.id, page]));
  const currentIds = new Set((currentSnapshot.pages ?? []).map((page) => page.id));
  const changes: DeploymentPageDiff[] = [];

  for (const page of currentSnapshot.pages ?? []) {
    const previous = previousById.get(page.id);
    if (!previous) {
      changes.push(pageSummary(page, 'added'));
    } else if (pageChanged(page, previous)) {
      changes.push(pageSummary(page, 'modified', previous));
    }
  }
  for (const page of previousSnapshot?.pages ?? []) {
    if (!currentIds.has(page.id)) {
      changes.push(pageSummary(page, 'removed', page));
    }
  }

  return { deployment: stripSnapshot(deployment), previousDeployment: previousDeployment ? stripSnapshot(previousDeployment) : null, changes };
};

/**
 * Diff every current docs version against the last published snapshot, so the
 * publish dialog can show exactly which pages will change (Mintlify-style).
 */
export const getPendingChanges = async (projectId: string): Promise<PendingChanges> => {
  const latest = await getLatestReadyDeployment(projectId);
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    include: { languages: { orderBy: { position: 'asc' } }, branches: { orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }] } },
  });
  if (!project) {
    throw notFound('project', { projectId });
  }
  const branchIds = project.branches.map((branch) => branch.id);
  const pages = await prisma.page.findMany({
    where: { projectId, ...(branchIds.length > 0 ? { branchId: { in: branchIds } } : {}) },
    orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
    include: { language: { select: { code: true } }, branch: { select: { id: true, name: true, isDefault: true } } },
  });
  const pageRows = pages.map(({ language, ...page }) => ({ ...page, languageCode: language?.code }));
  const current = buildSnapshot(project, pageRows, new Date().toISOString()).pages;

  // No baseline → first publish: every page is new.
  if (!latest?.snapshot) {
    return {
      hasBaseline: false,
      lastVersion: null,
      lastPublishedAt: null,
      changes: current.map((p) => pageSummary(p, 'added')),
    };
  }

  const snap = latest.snapshot as unknown as SiteSnapshot;
  const prevById = new Map((snap.pages ?? []).map((p) => [p.id, p]));
  const currentIds = new Set(current.map((p) => p.id));
  const changes: PendingChange[] = [];

  for (const p of current) {
    const prev = prevById.get(p.id);
    if (!prev) {
      changes.push(pageSummary(p, 'added'));
    } else if (pageChanged(p, prev)) {
      changes.push(pageSummary(p, 'modified', prev));
    }
  }
  for (const prev of snap.pages ?? []) {
    if (!currentIds.has(prev.id)) {
      changes.push(pageSummary(prev, 'removed', prev));
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
