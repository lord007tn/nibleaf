import { createJob, QueueNames } from '@nibleaf/bullmq';
import type { PublishDeploymentJobData } from '@nibleaf/bullmq/jobs/publish';
import { type Deployment, deliveryPlanSelect, loadDefaultDeliveryPlan, Prisma, prisma } from '@nibleaf/database';
import { projectAddonRowsForDelivery } from '@nibleaf/shared/addons';
import {
  normalizeRedirectPath,
  type RedirectPair,
  type RedirectValidationIssue,
  resolveRedirectTarget,
  summarizeRedirectIssues,
  validateSnapshotRedirects,
} from '@nibleaf/shared/redirects';
import { buildSnapshot, publishedVersionSlugs, type SiteSnapshot, type SnapshotPage } from '@nibleaf/shared/site';
import type { CreateDeploymentBody } from '@nibleaf/validators';
import { diffLines } from 'diff';
import { AppError, badRequest, notFound } from '@/errors';
import { collectPublishChecks, type PublishCheck } from '@/lib/publish-checks';
import { reviewedSnapshotDigest } from '@/lib/reviewed-snapshot';
import { logPlatformEvent } from './platform-events';
import { hasRealPageContent } from './project-starters';
import { assertProjectInOrg } from './projects';

const isPlainObject = (value: unknown): value is Record<string, unknown> => Object.prototype.toString.call(value) === '[object Object]';

/** List columns are explicitly selected so the multi-MB `snapshot` JSONB is
 *  never shipped for all 50 rows. `errorDetails` IS included — the dashboard's
 *  failure card reads it off the latest deployment in this list — but it's
 *  bounded at publish time (see the worker's capIssues), so it can't bloat the
 *  payload. Fields mirror the app's `Deployment` type.
 *
 *  `status: 'READY'` lists only publishes that went live, newest first: what's
 *  live now and the versions a rollback can return to, however many failed
 *  attempts came after them (the unfiltered list is the newest 50 attempts). */
export const listDeployments = (projectId: string, filter: { status?: 'READY' } = {}) =>
  prisma.deployment.findMany({
    where: { projectId, ...(filter.status ? { status: filter.status } : {}) },
    orderBy: { version: 'desc' },
    take: 50,
    select: {
      id: true,
      version: true,
      status: true,
      pagesCount: true,
      commitMessage: true,
      error: true,
      errorDetails: true,
      createdAt: true,
      completedAt: true,
    },
  });

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
interface PendingChange extends DeploymentPageDiff {}

/** What will change on the next publish, vs. the last READY deployment. */
export interface PendingChanges {
  /** A content page differs from the untouched new-site starters. */
  hasRealContent: boolean;
  reviewedStateHash: string;
  /** false = never published, so everything counts as new. */
  hasBaseline: boolean;
  /** true = a publish now would put out exactly what is live: no page, settings,
   *  navigation, redirect or API reference change. Only with a baseline. */
  upToDate: boolean;
  /** Navigation groups were added, removed or changed. `changes` lists pages
   *  only, so a publish that also reshapes the navigation says so here. */
  groupsChanged: boolean;
  lastVersion: number | null;
  lastPublishedAt: string | null;
  changes: PendingChange[];
  /** Blocking redirect issues for the exact draft snapshot being previewed. */
  redirectIssues: RedirectValidationIssue[];
  /** Quality checks for the same snapshot. Warnings leave publishing allowed;
   *  an `error` is something the publish worker would reject. */
  checks: PublishCheck[];
}

interface DeploymentDiffLine {
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
  /** A modified page's live address when the draft moved it (path or
   *  language), so a copied link can point at what readers can open now. */
  published?: { path: string; languageCode: string };
}

/** Read the complete effective publish input once and compose the same snapshot
 * shape the worker will validate. Keeping preflight and worker inputs aligned
 * prevents the dashboard from approving a different route graph. A publish
 * passes its transaction, so the read happens under the project lock. */
export const getCurrentSnapshot = async (projectId: string, db: Prisma.TransactionClient = prisma): Promise<SiteSnapshot> => {
  const project = await db.project.findUnique({
    where: { id: projectId },
    include: {
      languages: { orderBy: { position: 'asc' }, include: { projectTranslations: { take: 1 } } },
      branches: { orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }], omit: { forkBaseline: true } },
      openApiDocument: true,
      addons: { select: { key: true, enabled: true, config: true } },
      organization: {
        select: {
          usagePlan: {
            select: {
              status: true,
              effectiveAt: true,
              expiresAt: true,
              plan: { select: deliveryPlanSelect },
            },
          },
        },
      },
    },
  });
  if (!project) {
    throw notFound('project', { projectId });
  }
  const branchIds = project.branches.map((branch) => branch.id);
  const pages = await db.page.findMany({
    where: { projectId, branchId: { in: branchIds } },
    orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
    include: { language: { select: { code: true } } },
  });
  const pageRows = pages.map(({ language, createdAt, updatedAt, ...page }) => ({
    ...page,
    languageCode: language.code,
    createdAt: createdAt.toISOString(),
    updatedAt: updatedAt.toISOString(),
  }));
  return buildSnapshot(
    { ...project, addons: projectAddonRowsForDelivery(project.addons, project.organization.usagePlan, await loadDefaultDeliveryPlan(db)) },
    pageRows,
    new Date().toISOString(),
  );
};

/** Stable JSON compare (key-order independent) for the page `config` blob. */
function stableEqual(a: unknown, b: unknown): boolean {
  const norm = (v: unknown): unknown => {
    if (v === null || v === undefined) {
      return null;
    }
    if (Array.isArray(v)) {
      return v.map(norm);
    }
    if (isPlainObject(v)) {
      return Object.fromEntries(
        Object.entries(v)
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
    languageCode: string;
  },
  prev: SnapshotPage,
): boolean {
  return (
    // A page moved to another language can keep its slug, path, parent and
    // position (e.g. top level of an empty language), so compare the language too.
    draft.languageCode !== prev.languageCode ||
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
    ...(status === 'modified' && previous && (previous.path !== page.path || previous.languageCode !== page.languageCode)
      ? { published: { path: previous.path, languageCode: previous.languageCode } }
      : {}),
  };
};

const openApiSummary = (current: SiteSnapshot['openapi'], previous: SiteSnapshot['openapi'], languageCode: string): DeploymentPageDiff | null => {
  if (!(current || previous)) return null;
  if (current && previous && current.contentHash === previous.contentHash && current.title === previous.title && current.path === previous.path) {
    return null;
  }
  const item = current ?? previous;
  if (!item) return null;
  const status: DeploymentPageDiff['status'] = !previous ? 'added' : !current ? 'removed' : 'modified';
  const fields = [
    ...(current && previous && current.title !== previous.title ? ['title'] : []),
    ...(current && previous && current.path !== previous.path ? ['path'] : []),
    ...(!current || !previous || current.contentHash !== previous.contentHash ? ['OpenAPI document'] : []),
  ];
  return {
    id: 'openapi-reference',
    title: item.title,
    path: item.path,
    languageCode,
    kind: 'PAGE',
    status,
    fields,
    additions: 0,
    deletions: 0,
    lines: [],
    truncated: false,
  };
};

const stripSnapshot = <T extends { snapshot: unknown }>(deployment: T): Omit<T, 'snapshot'> => {
  const { snapshot: _snapshot, ...rest } = deployment;
  return rest;
};

export const getDeploymentDiff = async (projectId: string, id: string) => {
  const deployment = await getDeployment(projectId, id);
  if (deployment.status !== 'READY' || !deployment.snapshot) {
    throw badRequest('Only a published deployment with a snapshot has a diff.', { id });
  }
  const previousDeployment = await prisma.deployment.findFirst({
    where: { projectId, status: 'READY', version: { lt: deployment.version } },
    orderBy: { version: 'desc' },
  });

  const currentSnapshot = deployment.snapshot as unknown as SiteSnapshot;
  const currentPages = currentSnapshot.pages.filter((page) => page.kind === 'PAGE');
  const previousSnapshot = previousDeployment?.snapshot ? (previousDeployment.snapshot as unknown as SiteSnapshot) : null;
  const previousPages = previousSnapshot ? previousSnapshot.pages.filter((page) => page.kind === 'PAGE') : [];
  const previousById = new Map(previousPages.map((page) => [page.id, page]));
  const currentIds = new Set(currentPages.map((page) => page.id));
  const changes: DeploymentPageDiff[] = [];

  for (const page of currentPages) {
    const previous = previousById.get(page.id);
    if (!previous) {
      changes.push(pageSummary(page, 'added'));
    } else if (pageChanged(page, previous)) {
      changes.push(pageSummary(page, 'modified', previous));
    }
  }
  for (const page of previousPages) {
    if (!currentIds.has(page.id)) {
      changes.push(pageSummary(page, 'removed', page));
    }
  }
  const specChange = openApiSummary(currentSnapshot.openapi, previousSnapshot?.openapi, currentSnapshot.project.languages[0]?.code ?? 'en');
  if (specChange) changes.push(specChange);

  return { deployment: stripSnapshot(deployment), previousDeployment: previousDeployment ? stripSnapshot(previousDeployment) : null, changes };
};

/**
 * Diff every current docs version against the last published snapshot, so the
 * publish dialog can show exactly which pages will change (Mintlify-style).
 * A caller that must bind a decision to the exact state it summarized (the MCP
 * publish preview) passes the `draftSnapshot` it already read.
 */
export const getPendingChanges = async (projectId: string, draftSnapshot?: SiteSnapshot): Promise<PendingChanges> => {
  const latest = await getLatestReadyDeployment(projectId);
  const validation = validateSnapshotRedirects(draftSnapshot ?? (await getCurrentSnapshot(projectId)));
  const currentSnapshot = validation.snapshot;
  const current = currentSnapshot.pages.filter((page) => page.kind === 'PAGE');
  const hasRealContent = hasRealPageContent(currentSnapshot.pages);

  // No baseline → first publish: every page is new.
  if (!latest?.snapshot) {
    const firstSpecChange = openApiSummary(currentSnapshot.openapi, null, currentSnapshot.project.languages[0]?.code ?? 'en');
    return {
      hasRealContent,
      reviewedStateHash: reviewedSnapshotDigest(currentSnapshot),
      hasBaseline: false,
      upToDate: false,
      groupsChanged: currentSnapshot.pages.some((page) => page.kind === 'GROUP'),
      lastVersion: null,
      lastPublishedAt: null,
      changes: [...current.map((p) => pageSummary(p, 'added')), ...(firstSpecChange ? [firstSpecChange] : [])],
      redirectIssues: validation.issues,
      checks: collectPublishChecks(currentSnapshot),
    };
  }

  const snap = latest.snapshot as unknown as SiteSnapshot;
  const previous = snap.pages.filter((page) => page.kind === 'PAGE');
  const prevById = new Map(previous.map((p) => [p.id, p]));
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
  for (const prev of previous) {
    if (!currentIds.has(prev.id)) {
      changes.push(pageSummary(prev, 'removed', prev));
    }
  }
  const specChange = openApiSummary(currentSnapshot.openapi, snap.openapi, currentSnapshot.project.languages[0]?.code ?? 'en');
  if (specChange) changes.push(specChange);

  const groups = (pages: SnapshotPage[]) => new Map(pages.filter((page) => page.kind === 'GROUP').map((page) => [page.id, page]));
  const currentGroups = groups(currentSnapshot.pages);
  const previousGroups = groups(snap.pages);
  const groupsChanged =
    currentGroups.size !== previousGroups.size ||
    [...currentGroups].some(([id, group]) => {
      const before = previousGroups.get(id);
      return !before || pageChanged(group, before);
    });

  const reviewedStateHash = reviewedSnapshotDigest(currentSnapshot);
  return {
    reviewedStateHash,
    hasRealContent,
    hasBaseline: true,
    groupsChanged,
    // The page list only compares pages; settings, redirects and languages also
    // ship with a publish. The live snapshot is the reviewed input the worker
    // stored, so equal output digests mean nothing at all would change.
    upToDate: changes.length === 0 && reviewedSnapshotDigest(snap) === reviewedStateHash,
    lastVersion: latest.version,
    lastPublishedAt: latest.completedAt?.toISOString() ?? null,
    changes,
    redirectIssues: validation.issues,
    checks: collectPublishChecks(currentSnapshot),
  };
};

const MAX_VERSION_RETRIES = 5;

/** Bounds of the section that holds the project lock while a publish creates
 *  its row (withPublishLock). Prisma's transaction timeout alone bounds
 *  neither: its ROLLBACK queues behind a statement still waiting in
 *  PostgreSQL, so the connection stays pinned. These are PostgreSQL's own
 *  limits, set per transaction. Exported so a test can shorten them. */
export const publishLockBounds = {
  /** Waiting for the project lock. A structural page save holds it about
   *  0.2 s (a 313-page address change in pages.address-changes.postgres.test),
   *  at most STRUCTURAL_UPDATE_TIMEOUT_MS (30 s); a Git apply up to a minute.
   *  After 10 s the writer gets a retryable error instead of a hung request. */
  lockTimeoutMs: 10_000,
  /** Any one statement under the lock. The largest is the snapshot's page
   *  read: about 10 ms for 202 pages and 0.2 s for 2,000 pages of 20 kB
   *  (whole snapshot read, measured locally). 20 s leaves room for sites far
   *  larger and a loaded database, while still ending a stalled read. */
  statementTimeoutMs: 20_000,
  /** Waiting for a pooled connection to begin (Prisma's maxWait, made explicit). */
  poolWaitMs: 2000,
  /** The whole section, shared by every version-conflict retry so retries
   *  cannot multiply the wait. */
  totalMs: 30_000,
};

export const nextDeploymentVersion = async (db: Prisma.TransactionClient, projectId: string) =>
  ((await db.deployment.aggregate({ where: { projectId }, _max: { version: true } }))._max.version ?? 0) + 1;

/** A publish gave up waiting for a concurrent change: retry shortly. 409 like
 *  `mcp:publish_in_progress` (the site is busy, the server is healthy), which
 *  also keeps the message readable for MCP clients (they hide 5xx messages). */
const publishBusy = (cause?: unknown) =>
  new AppError({ code: 'publish:busy', message: 'Another change is being saved. Try publishing again in a moment.', cause });

/** PostgreSQL lock_not_available (55P03, lock_timeout) and query_canceled
 *  (57014, statement_timeout), which the pg driver adapter reports as a known
 *  request error (P2010 for raw queries) with the PostgreSQL code in
 *  `meta.driverAdapterError.cause.originalCode`, and Prisma's transaction API
 *  error (P2028: no connection within maxWait, or the transaction's timeout). */
const publishBoundExceeded = (error: unknown): boolean => {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError)) return false;
  if (error.code === 'P2028') return true;
  const cause = (error.meta as { driverAdapterError?: { cause?: { originalCode?: unknown } } } | undefined)?.driverAdapterError?.cause;
  return cause?.originalCode === '55P03' || cause?.originalCode === '57014';
};

/** Run `work` holding the project row FOR SHARE, within publishLockBounds;
 *  exceeding them is a retryable `publish:busy`. A version conflict (P2002)
 *  runs it again from the start, inside the same overall deadline.
 *
 *  Lock order: the project row only. Structural page writes take it FOR NO
 *  KEY UPDATE and then page rows; this takes it FOR SHARE, which conflicts
 *  with them but not with other publishes, saves that do not move a page, or
 *  inserts that reference the project. `work` only reads and inserts a
 *  deployment row, locking no page or deployment row, so a transaction
 *  waiting on this one holds nothing it needs. */
export const withPublishLock = <T>(projectId: string, work: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> => {
  const { lockTimeoutMs, statementTimeoutMs, poolWaitMs, totalMs } = publishLockBounds;
  const deadline = Date.now() + totalMs;
  return retryVersionConflicts(async () => {
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw publishBusy();
    const within = (ms: number) => Math.max(1, Math.min(ms, remaining));
    try {
      return await prisma.$transaction(
        async (tx) => {
          // set_config(…, true) is SET LOCAL with bind parameters: this transaction only.
          await tx.$queryRaw`SELECT set_config('lock_timeout', ${`${within(lockTimeoutMs)}ms`}, true) AS lock_timeout,
            set_config('statement_timeout', ${`${within(statementTimeoutMs)}ms`}, true) AS statement_timeout`;
          await tx.$queryRaw`SELECT 1 FROM "project" WHERE id = ${projectId} FOR SHARE`;
          return await work(tx);
        },
        { maxWait: within(poolWaitMs), timeout: remaining },
      );
    } catch (error) {
      if (publishBoundExceeded(error)) throw publishBusy(error);
      throw error;
    }
  });
};

/** Run `create` (allocate the next version, create a deployment) again when a
 *  concurrent publish/rollback grabs the same version. `max(version)+1` then
 *  `create` is a read-then-write race; the `@@unique([projectId, version])`
 *  constraint turns a collision into a P2002 we recompute-and-retry instead of
 *  surfacing as a 500. */
async function retryVersionConflicts<T>(create: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await create();
    } catch (err) {
      const isVersionConflict = err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002';
      if (isVersionConflict && attempt < MAX_VERSION_RETRIES - 1) {
        continue;
      }
      throw err;
    }
  }
}

const createWithNextVersion = <T>(projectId: string, build: (version: number) => Promise<T>): Promise<T> =>
  retryVersionConflicts(async () => build(await nextDeploymentVersion(prisma, projectId)));

/** A redirect target as the router compares it: normalized path and query,
 *  without the fragment (it lands on the same page). */
const comparableTarget = (href: string): string | null => {
  const [pathname = '', query = ''] = (href.split('#')[0] ?? '').split('?');
  try {
    return `${normalizeRedirectPath(pathname)}?${new URLSearchParams(query).toString()}`;
  } catch {
    return null;
  }
};

/** Whether a reviewed `input` (read before the publish took the project lock)
 *  would put a page live at an address readers could not follow to the page's
 *  draft address. A page counts as moved when its draft address (version,
 *  language, path) differs from the reviewed one. A moved page is accepted
 *  only when the reviewed address is
 *  - its address in the newest live version: readers already use it, and the
 *    later move recorded a redirect from it; or
 *  - the source of a redirect that resolves to its draft address.
 *  Anything else (a first-title adoption, a page renamed twice since the
 *  review: live /intro, reviewed /first, draft /second has no /first →
 *  /second) needs a fresh review. Run under the project lock. */
const reviewedAddressesStale = async (tx: Prisma.TransactionClient, projectId: string, input: SiteSnapshot): Promise<boolean> => {
  const drafts = await tx.$queryRaw<Array<{ id: string; branchId: string; path: string; code: string }>>`
    SELECT draft.id, draft."branchId", draft.path, lang.code FROM "page" draft JOIN "language" lang ON lang.id = draft."languageId"
    WHERE draft."projectId" = ${projectId}`;
  const draftById = new Map(drafts.map((draft) => [draft.id, draft]));
  const moved = input.pages.flatMap((page) => {
    const draft = draftById.get(page.id);
    return draft && (draft.branchId !== page.versionId || draft.code !== page.languageCode || draft.path !== page.path) ? [{ page, draft }] : [];
  });
  if (moved.length === 0) return false;
  const live = await tx.$queryRaw<Array<{ id: string; versionId: string | null; languageCode: string | null; path: string | null }>>`
    SELECT page ->> 'id' AS id, page ->> 'versionId' AS "versionId", page ->> 'languageCode' AS "languageCode", page ->> 'path' AS path
    FROM (
      SELECT snapshot FROM "deployment" WHERE "projectId" = ${projectId} AND status = 'READY' ORDER BY version DESC LIMIT 1
    ) latest, jsonb_array_elements(latest.snapshot -> 'pages') page
    WHERE page ->> 'id' IN (${Prisma.join(moved.map(({ page }) => page.id))})`;
  const liveById = new Map(live.map((row) => [row.id, row]));
  const unseen = moved.filter(({ page }) => {
    const readers = liveById.get(page.id);
    return !(readers && readers.versionId === page.versionId && readers.languageCode === page.languageCode && readers.path === page.path);
  });
  if (unseen.length === 0) return false;
  const project = await tx.project.findUniqueOrThrow({
    where: { id: projectId },
    select: {
      config: true,
      branches: { orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }], select: { id: true, name: true, isDefault: true } },
      languages: { select: { code: true, isDefault: true } },
    },
  });
  const stored = (project.config as { redirects?: unknown } | null)?.redirects;
  const redirects = Array.isArray(stored) ? (stored as RedirectPair[]) : [];
  const reviewedPrefix = new Map(input.project.versions.map((version) => [version.id, version.isDefault ? '' : version.slug]));
  const slugs = publishedVersionSlugs(project.branches);
  const draftPrefix = new Map(project.branches.map((branch) => [branch.id, branch.isDefault ? '' : (slugs.get(branch.id) ?? branch.id)]));
  const defaultCode = project.languages.find((language) => language.isDefault)?.code;
  return unseen.some(({ page, draft }) => {
    const from = `/${[reviewedPrefix.get(page.versionId), page.path].filter(Boolean).join('/')}`;
    const to = `/${[draftPrefix.get(draft.branchId), draft.path].filter(Boolean).join('/')}${draft.code === defaultCode ? '' : `?lang=${encodeURIComponent(draft.code)}`}`;
    const target = resolveRedirectTarget(redirects, from);
    return target === null || comparableTarget(target) !== comparableTarget(to);
  });
};

const reviewStale = () =>
  new AppError({ code: 'mcp:preview_stale', message: 'Your site changed since you reviewed it. Review the changes again before publishing.' });

/** Dashboard publish options. `skipGrammarChecks` lets the user publish past the
 *  grammar linter after reviewing its findings — broken links still block. */
export interface PublishDeploymentBody extends CreateDeploymentBody {
  firstPublishAttribution?: PublishDeploymentJobData['firstPublishAttribution'];
  skipGrammarChecks?: boolean;
}

/** A terminal enqueue failure is visible immediately and cannot be activated by
 * a delayed queue acknowledgement. The worker claims PENDING atomically. */
const enqueuePublish = async (deployment: Deployment, data: PublishDeploymentJobData) => {
  try {
    await createJob(QueueNames.PUBLISH, { name: 'publish-deployment', data }, { jobId: `publish-${deployment.id}` });
  } catch (cause) {
    const message = 'Publishing could not be queued. Please try publishing again.';
    const settled = await prisma.deployment.updateMany({
      where: { id: deployment.id, projectId: deployment.projectId, status: 'PENDING' },
      data: { status: 'FAILED', error: message, completedAt: new Date() },
    });
    // A worker may already have claimed an accepted job whose ACK was lost.
    if (settled.count === 0) return getDeployment(deployment.projectId, deployment.id);
    throw new AppError({ code: 'http:internal', message, details: { deploymentId: deployment.id }, cause });
  }
  return deployment;
};

/** Create a PENDING deployment and enqueue the publish job for the worker to build. */
export const createDeployment = async (
  organizationId: string,
  projectId: string,
  userId: string,
  body: PublishDeploymentBody,
  locale?: string,
  approvedSnapshot?: SiteSnapshot,
) => {
  const project = await assertProjectInOrg(organizationId, projectId);
  if (project.takedownAt) {
    throw badRequest('This site has been taken down by the platform moderators and cannot be published. Contact support@nibleaf.com.', { projectId });
  }
  // Validate before version allocation, then persist this exact input for the
  // worker. It repeats checks against the immutable input rather than new drafts.
  let reviewedInput = approvedSnapshot;
  if (body.reviewedDeploymentId) {
    const reviewed = await prisma.deployment.findFirst({
      where: { id: body.reviewedDeploymentId, projectId, status: 'FAILED' },
      select: { approvedSnapshot: true },
    });
    if (!reviewed?.approvedSnapshot) {
      throw new AppError({ code: 'mcp:preview_stale', message: 'Review the changes again before publishing.' });
    }
    reviewedInput = reviewed.approvedSnapshot as unknown as SiteSnapshot;
  }
  // The input is read and the PENDING row created under the project lock, in
  // one transaction (withPublishLock: lock order and bounds there). A
  // first-title address adoption (updatePage in ./pages) runs under the same
  // lock and is refused once a publish is pending, so it either commits
  // before the read (and goes live at its new address) or waits for the row
  // (and keeps the address being published). Without the lock it could commit
  // between the two steps: live at the old address, the draft at the new one,
  // and no redirect. A reviewed input was read before the lock, so its
  // addresses are re-checked under it instead. Held for the read and the
  // insert only; the worker builds after the commit.
  const deployment = await withPublishLock(projectId, async (tx) => {
    if (reviewedInput && (await reviewedAddressesStale(tx, projectId, reviewedInput))) throw reviewStale();
    const redirectValidation = validateSnapshotRedirects(reviewedInput ?? (await getCurrentSnapshot(projectId, tx)));
    if (redirectValidation.issues.length > 0) {
      throw badRequest(summarizeRedirectIssues(redirectValidation.issues), { redirectIssues: redirectValidation.issues });
    }
    if (body.reviewedStateHash && body.reviewedStateHash !== reviewedSnapshotDigest(redirectValidation.snapshot)) {
      throw reviewStale();
    }
    return tx.deployment.create({
      data: {
        projectId,
        version: await nextDeploymentVersion(tx, projectId),
        status: 'PENDING',
        approvedSnapshot: redirectValidation.snapshot as unknown as Prisma.InputJsonValue,
        createdById: userId,
        ...(body.message ? { commitMessage: body.message } : {}),
      },
    });
  });
  const jobData: PublishDeploymentJobData = {
    deploymentId: deployment.id,
    projectId,
    skipGrammarChecks: body.skipGrammarChecks === true,
    auto: false,
    ...(body.firstPublishAttribution ? { firstPublishAttribution: body.firstPublishAttribution } : {}),
    locale,
  };
  const queued = await enqueuePublish(deployment, jobData);
  logPlatformEvent('publish_clicked', { userId, projectId, metadata: { auto: false, version: deployment.version } });
  const { approvedSnapshot: _approvedSnapshot, ...result } = queued;
  return result;
};

/** Re-publish a previous READY deployment's snapshot as a new deployment. */
export const rollbackDeployment = async (organizationId: string, projectId: string, deploymentId: string, userId: string, locale?: string) => {
  const project = await assertProjectInOrg(organizationId, projectId);
  if (project.takedownAt) {
    throw badRequest('This site has been taken down by the platform moderators and cannot be published. Contact support@nibleaf.com.', { projectId });
  }
  const target = await prisma.deployment.findFirst({ where: { id: deploymentId, projectId } });
  if (!target) {
    throw notFound('deployment', { id: deploymentId });
  }
  if (target.status !== 'READY' || !target.snapshot) {
    throw badRequest('Only a published deployment with a snapshot can be rolled back to.', { id: deploymentId });
  }
  const deployment = await createWithNextVersion(projectId, (version) =>
    prisma.deployment.create({
      data: {
        projectId,
        version,
        status: 'PENDING',
        snapshot: target.snapshot as Prisma.InputJsonValue,
        assetReferenceIndex: target.assetReferenceIndex ?? Prisma.DbNull,
        assetReferenceBytes: target.assetReferenceBytes,
        assetSourceBytes: target.assetSourceBytes,
        assetSourcePages: target.assetSourcePages,
        pagesCount: target.pagesCount,
        commitMessage: `Rollback to v${target.version}`,
        createdById: userId,
      },
    }),
  );
  return enqueuePublish(deployment, { deploymentId: deployment.id, projectId, auto: false, locale });
};
