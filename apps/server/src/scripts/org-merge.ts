import { createHash, randomUUID } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { Prisma, prisma } from '@nibleaf/database';
import { effectiveSiteRole, rankOf } from '@nibleaf/shared/rbac';

type Row = Record<string, any>;
type Snapshot = Record<string, Row[]>;
type Db = Prisma.TransactionClient;
export interface QuotaStore {
  merge(runId: string, keys: string[], survivorKey: string): Promise<void>;
}
export interface Permission {
  userId: string;
  orgRoles: Record<string, string>;
  websites: Record<string, string | null>;
}
export interface MergeGroup {
  key: string;
  ownerId: string;
  ownerName: string;
  ownerEmail: string;
  orgIds: string[];
  survivorId: string;
  name: string;
  slug: string;
  digest: string;
  rowDigests: Record<string, Record<string, string>>;
  decision?: { plan: string; organizationId: string; reason: string };
  reasons: string[];
  before: Permission[];
  after: Permission[];
  quota: { day: string; keys: string[]; survivorKey: string };
  summary: Row;
}
export interface MergePlan {
  version: 1;
  runId: string;
  groups: MergeGroup[];
  excluded: Row[];
}

const primaryKeys: Record<string, string[]> = {
  organization: ['id'],
  member: ['id'],
  project: ['id'],
  project_member: ['id'],
  invitation: ['id'],
  invitation_grant: ['invitationId', 'projectId'],
  join_link: ['id'],
  join_link_grant: ['joinLinkId', 'projectId'],
  join_link_use: ['id'],
  join_link_redemption: ['joinLinkId', 'userId'],
  organization_handle: ['slug'],
  organization_usage_plan: ['organizationId'],
  notification: ['id'],
  organization_git_webhook_secret: ['organizationId'],
};
const moveOrder = [
  'member',
  'project',
  'invitation',
  'join_link',
  'project_member',
  'invitation_grant',
  'join_link_grant',
  'organization_handle',
  'notification',
  'organization_usage_plan',
  'organization',
];
const quote = (name: string) => `"${name.replaceAll('"', '""')}"`;
export const canonical = (value: unknown): string =>
  JSON.stringify(value, (_key, item) => {
    if (item && typeof item === 'object' && !Array.isArray(item))
      return Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b)));
    return typeof item === 'bigint' ? item.toString() : item;
  });
export const digest = (value: unknown) => createHash('sha256').update(canonical(value)).digest('hex');
const snapshotKeys: Record<string, string[]> = {
  ...primaryKeys,
  usage_storage_marker: ['organizationId'],
  usage_ingest_checkpoint: ['id'],
  usage_provider_checkpoint: ['id'],
  project_git_settings: ['projectId'],
  project_git_webhook_secret: ['projectId'],
  project_legacy_settings: ['projectId'],
  user: ['id'],
};
const keyFor = (table: string, row: Row) => canonical((snapshotKeys[table] ?? ['id']).map((key) => row[key]));
const byKey = (table: string, rows: Row[]) => new Map(rows.map((row) => [keyFor(table, row), row]));
const sortRows = (rows: Row[]) => rows.sort((a, b) => canonical(a).localeCompare(canonical(b)));
const json = (value: string | null) => (value ? (JSON.parse(value) as Row) : {});
const allowedMetadata = new Set(['plan', 'entitlements', 'notifications', 'git', 'integrations']);
const validSlug = (slug: string) =>
  /^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug) && !['new', 'settings', 'welcome', 'o', 'api', 'app', 'admin'].includes(slug);
export const mergedName = (names: string[], ownerName: string) => {
  const named = names.filter((name) => name !== 'My workspace' && !/^.+['’]s workspace$/.test(name));
  if (named.length === 1) return named[0] ?? 'My organization';
  const first = ownerName.trim().split(/\s+/)[0];
  return first ? `${first}'s organization` : 'My organization';
};

/** Plans contain fingerprints, never the raw snapshot or secret values. */
export async function snapshot(tx: Db, orgIds: string[]): Promise<Snapshot> {
  const ids = Prisma.join(orgIds);
  const result: Snapshot = {};
  for (const table of Object.keys(primaryKeys)) {
    let where: Prisma.Sql;
    if (table === 'organization') where = Prisma.sql`id IN (${ids})`;
    else if (table === 'join_link_use' || table === 'join_link_redemption')
      where = Prisma.sql`"joinLinkId" IN (SELECT id FROM join_link WHERE "organizationId" IN (${ids}))`;
    else where = Prisma.sql`"organizationId" IN (${ids})`;
    const rows = await tx.$queryRaw<Array<{ row: Row }>>(Prisma.sql`SELECT to_jsonb(t) AS row FROM ${Prisma.raw(quote(table))} t WHERE ${where}`);
    result[table] = sortRows(rows.map(({ row }) => row));
  }
  const projectIds = (result.project ?? []).map((row) => row.id as string);
  for (const table of [
    'usage_storage_marker',
    'usage_ingest_checkpoint',
    'usage_provider_checkpoint',
    'project_git_settings',
    'project_git_webhook_secret',
    'project_legacy_settings',
  ]) {
    const where = projectIds.length ? Prisma.sql`"projectId" IN (${Prisma.join(projectIds)})` : Prisma.sql`false`;
    const legacy = table.startsWith('usage_') ? Prisma.sql`OR "organizationId" IN (${ids})` : Prisma.empty;
    const rows = await tx.$queryRaw<Array<{ row: Row }>>(
      Prisma.sql`SELECT to_jsonb(t) AS row FROM ${Prisma.raw(quote(table))} t WHERE ${where} ${legacy}`,
    );
    result[table] = sortRows(rows.map(({ row }) => row));
  }
  const users = [
    ...new Set(
      [
        ...(result.member ?? []).map((row) => row.userId),
        ...(result.invitation ?? []).map((row) => row.inviterId),
        ...(result.join_link ?? []).map((row) => row.createdById),
      ].filter(Boolean),
    ),
  ] as string[];
  result.user = users.length
    ? await tx.$queryRaw<Row[]>(Prisma.sql`SELECT id,name,email,banned,"suspendedAt" FROM "user" WHERE id IN (${Prisma.join(users)}) ORDER BY id`)
    : [];
  return result;
}

export function permissions(state: Snapshot): Permission[] {
  const users = [...new Set((state.member ?? []).map((row) => row.userId as string))].sort();
  return users.map((userId) => {
    const user = state.user?.find((row) => row.id === userId);
    const usable = user && !user.banned && !user.suspendedAt;
    const memberships = (state.member ?? []).filter((row) => row.userId === userId);
    return {
      userId,
      orgRoles: Object.fromEntries(
        (state.organization ?? []).flatMap((org) => {
          const member = memberships.find((row) => row.organizationId === org.id);
          return member ? [[org.id, usable ? member.orgRole : 'blocked']] : [];
        }),
      ),
      websites: Object.fromEntries(
        (state.project ?? []).map((project) => {
          const member = memberships.find((row) => row.organizationId === project.organizationId);
          const grant = state.project_member?.find((row) => row.projectId === project.id && row.userId === userId);
          return [project.id, usable && member ? effectiveSiteRole(member.orgRole, grant?.role ?? null) : null];
        }),
      ),
    };
  });
}

/** Materialize inherited site admin rights; never promote an org admin. */
function transformed(state: Snapshot, group: Pick<MergeGroup, 'ownerId' | 'survivorId' | 'name' | 'slug' | 'decision'>): Snapshot {
  const next = structuredClone(state);
  const survivor = next.organization?.find((row) => row.id === group.survivorId);
  if (!survivor) throw new Error('Survivor disappeared');
  const before = permissions(state);
  const members = next.member ?? [];
  const users = [...new Set(members.map((row) => row.userId as string))].sort();
  next.member = users.map((userId) => {
    const existing = members.find((row) => row.userId === userId && row.organizationId === group.survivorId);
    const source = existing ?? members.find((row) => row.userId === userId);
    return {
      ...source,
      id: existing?.id ?? `merge-${digest([group.survivorId, userId]).slice(0, 32)}`,
      organizationId: group.survivorId,
      orgRole: userId === group.ownerId ? 'owner' : 'member',
      role: userId === group.ownerId ? 'owner' : 'viewer',
      legacyWriter: false,
    };
  });
  // An organization-admin invitation must not turn into an organization-admin
  // invitation over unrelated websites after the merge.
  for (const invite of next.invitation ?? [])
    if (invite.kind === 'member' && invite.orgRole === 'admin') {
      for (const project of state.project ?? [])
        if (project.organizationId === invite.organizationId) {
          const grants = next.invitation_grant ?? [];
          const existing = grants.find((row) => row.invitationId === invite.id && row.projectId === project.id);
          if (existing) existing.role = 'admin';
          else grants.push({ invitationId: invite.id, organizationId: invite.organizationId, projectId: project.id, role: 'admin' });
          next.invitation_grant = grants;
        }
      invite.orgRole = 'member';
      invite.role = 'viewer';
      invite.legacyWriter = false;
    }
  const grants = next.project_member ?? [];
  for (const project of state.project ?? [])
    for (const member of members.filter((row) => row.organizationId === project.organizationId && row.orgRole === 'admin')) {
      const grant = grants.find((row) => row.projectId === project.id && row.userId === member.userId);
      if (grant) grant.role = 'admin';
      else
        grants.push({
          id: `merge-${digest([project.id, member.userId]).slice(0, 32)}`,
          organizationId: project.organizationId,
          projectId: project.id,
          userId: member.userId,
          role: 'admin',
          createdById: null,
          createdAt: member.createdAt,
          updatedAt: member.createdAt,
        });
    }
  next.project_member = grants;
  for (const table of ['project', 'project_member', 'invitation', 'invitation_grant', 'join_link', 'join_link_grant', 'organization_handle'])
    for (const row of next[table] ?? []) row.organizationId = group.survivorId;
  for (const row of next.notification ?? []) if (!row.projectId) row.organizationId = group.survivorId;
  for (const row of next.organization_handle ?? []) row.current = row.slug === group.slug;
  const meta = json(survivor.metadata);
  if (group.decision) {
    const chosen = json(state.organization?.find((org) => org.id === group.decision?.organizationId)?.metadata ?? null);
    for (const key of ['plan', 'entitlements']) {
      if (key in chosen) meta[key] = chosen[key];
      else delete meta[key];
    }
  }
  meta.notifications = {
    ...meta.notifications,
    member_invited: !(state.organization ?? []).every((org) => json(org.metadata).notifications?.member_invited === false),
  };
  survivor.metadata = JSON.stringify(meta);
  survivor.name = group.name;
  survivor.slug = group.slug;
  next.organization = [survivor];
  const plan = group.decision
    ? next.organization_usage_plan?.find((row) => row.organizationId === group.decision?.organizationId && row.planId === group.decision?.plan)
    : next.organization_usage_plan?.find((row) => row.organizationId === group.survivorId);
  next.organization_usage_plan = plan ? [{ ...plan, organizationId: group.survivorId }] : [];
  next.organization_git_webhook_secret = (next.organization_git_webhook_secret ?? []).filter((row) => row.organizationId === group.survivorId);
  for (const person of permissions(next)) {
    const prior = before.find((row) => row.userId === person.userId);
    for (const [site, role] of Object.entries(person.websites))
      if (rankOf(role ?? '') > rankOf(prior?.websites[site] ?? '')) throw new Error(`Permission gain for ${person.userId} on ${site}`);
    const role = person.orgRoles[group.survivorId];
    if (role === 'owner' && !Object.values(prior?.orgRoles ?? {}).includes('owner')) throw new Error('Organization ownership gain');
    if (role === 'admin' && !Object.values(prior?.orgRoles ?? {}).includes('admin')) throw new Error('Organization admin gain');
  }
  for (const rows of Object.values(next)) sortRows(rows);
  return next;
}

function makeGroup(state: Snapshot, ownerId: string, day: string, decision?: MergeGroup['decision']): MergeGroup {
  const orgs = [...(state.organization ?? [])].sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
  const owner = state.user?.find((row) => row.id === ownerId);
  const survivor = orgs.find((org) => state.project?.some((row) => row.organizationId === org.id)) ?? orgs[0];
  if (!survivor) throw new Error('Empty owner group');
  const handle = orgs.find((org) => validSlug(org.slug));
  const rowDigests = Object.fromEntries(
    Object.entries(state).map(([table, rows]) => [table, Object.fromEntries(rows.map((row) => [keyFor(table, row), digest(row)]))]),
  );
  const group: MergeGroup = {
    key: ownerId,
    ownerId,
    ownerName: owner?.name ?? '',
    ownerEmail: owner?.email ?? '(missing)',
    orgIds: orgs.map((row) => row.id),
    survivorId: survivor.id,
    name: mergedName(
      orgs.map((row) => row.name),
      owner?.name ?? '',
    ),
    slug: handle?.slug ?? survivor.slug,
    digest: digest(state),
    rowDigests,
    decision,
    reasons: [],
    before: permissions(state),
    after: [],
    quota: { day, keys: orgs.map((org) => `nibleaf:ai-quota:${org.id}:${day}`), survivorKey: `nibleaf:ai-quota:${survivor.id}:${day}` },
    summary: {},
  };
  if (orgs.some((org) => org.needsRepair || org.deletionStartedAt)) group.reasons.push('quarantined or deleting organization');
  if (orgs.some((org) => (state.member ?? []).filter((row) => row.organizationId === org.id && row.orgRole === 'owner').length !== 1))
    group.reasons.push('ownerless or multi-owner organization');
  if ((state.member ?? []).some((row) => row.orgRole === 'owner' && row.userId !== ownerId)) group.reasons.push('owner mismatch');
  if (orgs.some((org) => (state.member ?? []).filter((row) => row.organizationId === org.id && row.role === 'owner').length > 1))
    group.reasons.push('legacy multi-owner quarantine');
  for (const org of orgs) {
    const meta = json(org.metadata);
    const sensitive = Object.keys(meta).filter((key) => !['notifications', 'plan', 'entitlements'].includes(key));
    if (sensitive.length && org.metadata !== JSON.stringify(meta)) group.reasons.push('noncanonical legacy metadata requires operator normalization');
    const project = state.project?.find((site) => site.organizationId === org.id);
    for (const key of sensitive) {
      let copied: unknown;
      if (key === 'git') {
        const settings = state.project_git_settings?.find((row) => row.projectId === project?.id)?.settings;
        const secret = state.project_git_webhook_secret?.find((row) => row.projectId === project?.id)?.secret;
        copied = { ...settings, ...(secret ? { webhookSecret: secret } : {}) };
        if (digest(copied) !== digest(meta[key])) copied = settings;
      } else copied = state.project_legacy_settings?.find((row) => row.projectId === project?.id)?.metadata?.[key];
      if (digest(copied ?? null) !== digest(meta[key])) group.reasons.push(`legacy website copy differs: ${key}`);
    }
  }
  if (state.invitation?.some((row) => row.kind === 'bootstrap_owner' && row.status === 'pending'))
    group.reasons.push('pending bootstrap-owner invitation');
  if (state.usage_provider_checkpoint?.some((row) => row.status === 'pending')) group.reasons.push('pending provider receipts');
  const plans = orgs.map((org) => state.organization_usage_plan?.find((row) => row.organizationId === org.id));
  const planSet = new Set(plans.map((row) => canonical(row ? [row.planId, row.status, row.expiresAt] : null)));
  if (
    planSet.size > 1 &&
    !(decision?.reason.trim() && plans.some((row) => row?.organizationId === decision.organizationId && row.planId === decision.plan))
  )
    group.reasons.push('plan conflict: explicit human decision required');
  const metas = orgs.map((org) => json(org.metadata));
  const unknown = [...new Set(metas.flatMap((meta) => Object.keys(meta).filter((key) => !allowedMetadata.has(key))))].sort();
  const metadata = unknown.map((key) => ({ key, fingerprints: metas.map((meta) => digest(meta[key] ?? null)) }));
  for (const entry of metadata) if (new Set(entry.fingerprints).size > 1) group.reasons.push(`unclassified metadata differs: ${entry.key}`);
  for (const key of ['plan', 'entitlements'])
    if (new Set(metas.map((meta) => digest(meta[key] ?? null))).size > 1 && !decision) group.reasons.push(`metadata.${key} conflict`);
  const next = transformed(state, group);
  group.after = permissions(next);
  group.summary = {
    reason: 'oldest organization with a website, then lowest id',
    organizations: orgs.map((org) => ({
      id: org.id,
      name: org.name,
      websites: state.project?.filter((row) => row.organizationId === org.id).map((row) => row.slug),
    })),
    handles: state.organization_handle?.map((row) => ({ slug: row.slug, alias: row.slug !== group.slug })),
    plans: plans.map((row) => (row ? { planId: row.planId, status: row.status, expiresAt: row.expiresAt } : null)),
    membersBefore: state.member?.length,
    membersAfter: next.member?.length,
    invitations: state.invitation?.length,
    joinLinks: state.join_link?.length,
    uses: state.join_link_use?.length,
    metadata,
    notifications: metas.map((meta) => meta.notifications?.member_invited !== false),
    promotionCandidates: group.before
      .filter(
        (person) =>
          Object.values(person.websites).length > 0 && Object.values(person.websites).every((role) => rankOf(role ?? '') >= rankOf('admin')),
      )
      .map((person) => person.userId),
  };
  return group;
}

export async function planMerge(db = prisma, day = new Date().toISOString().slice(0, 10)): Promise<MergePlan> {
  return db.$transaction(
    async (tx) => {
      await tx.$executeRaw`SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY`;
      const orgs = await tx.$queryRaw<
        Row[]
      >`SELECT o.id,o."needsRepair",o."deletionStartedAt",count(m.id) FILTER(WHERE m."orgRole"='owner')::int AS owners,
      count(m.id) FILTER(WHERE m.role='owner')::int AS "legacyOwners", min(m."userId") FILTER(WHERE m."orgRole"='owner') AS "ownerId",
      (SELECT count(*)::int FROM project p WHERE p."organizationId"=o.id) AS websites
      FROM organization o LEFT JOIN member m ON m."organizationId"=o.id GROUP BY o.id ORDER BY o.id`;
      const excluded = orgs.filter((org) => org.needsRepair || org.deletionStartedAt || org.owners !== 1 || org.legacyOwners > 1);
      const eligible = orgs.filter((org) => !excluded.includes(org));
      const owners = [...new Set(eligible.map((org) => org.ownerId as string))].sort();
      const groups: MergeGroup[] = [];
      for (const ownerId of owners) {
        const ids = eligible.filter((org) => org.ownerId === ownerId).map((org) => org.id as string);
        if (ids.length > 1) groups.push(makeGroup(await snapshot(tx, ids), ownerId, day));
      }
      excluded.push(...orgs.filter((org) => org.websites === 0).map((org) => ({ id: org.id, reason: 'zero websites' })));
      const bootstrap = await tx.invitation.findMany({
        where: { kind: 'bootstrap_owner', status: 'pending' },
        select: { id: true, organizationId: true },
      });
      excluded.push(...bootstrap.map((row) => ({ ...row, reason: 'pending bootstrap invitation' })));
      const allMetadata = await tx.organization.findMany({ select: { id: true, metadata: true } });
      const unknownCounts = new Map<string, { count: number; fingerprints: string[] }>();
      for (const org of allMetadata) {
        try {
          for (const [key, value] of Object.entries(json(org.metadata)))
            if (!allowedMetadata.has(key)) {
              const entry = unknownCounts.get(key) ?? { count: 0, fingerprints: [] };
              entry.count++;
              entry.fingerprints.push(digest(value));
              unknownCounts.set(key, entry);
            }
        } catch {
          excluded.push({ id: org.id, reason: 'unparseable legacy metadata' });
        }
      }
      excluded.push(
        ...[...unknownCounts].sort(([a], [b]) => a.localeCompare(b)).map(([key, entry]) => ({ reason: 'unknown metadata key', key, ...entry })),
      );

      return { version: 1, runId: randomUUID(), groups, excluded };
    },
    { timeout: 120_000 },
  );
}

export function humanReport(plan: MergePlan) {
  const groups = plan.groups
    .map((group) =>
      [
        `Owner ${group.ownerEmail} (${group.ownerId})  group digest ${group.digest}`,
        `  survivor ${group.survivorId} -> "${group.name}"  handle ${group.slug} (${group.summary.reason})`,
        `  merges ${canonical(group.summary.organizations)}`,
        `  handles ${canonical(group.summary.handles)}`,
        `  plan ${canonical(group.summary.plans)}  provider receipts: ${group.reasons.includes('pending provider receipts') ? 'PENDING' : 'none pending'}`,
        `  people ${group.summary.membersBefore} -> ${group.summary.membersAfter}`,
        ...group.before.map(
          (person) => `    ${person.userId} before ${canonical(person)} after ${canonical(group.after.find((row) => row.userId === person.userId))}`,
        ),
        `  invitations ${group.summary.invitations}; join links ${group.summary.joinLinks} (${group.summary.uses} uses kept)`,
        `  unknown metadata ${canonical(group.summary.metadata)}`,
        `  notifications member_invited ${canonical(group.summary.notifications)} -> ${group.summary.notifications.every((v: boolean) => !v) ? 'off' : 'on'}`,
        `  Admin on every website (promotion candidates): ${canonical(group.summary.promotionCandidates)}`,
        `  quota keys ${canonical(group.quota.keys)}`,
        `  result ${group.reasons.length ? `SKIP: ${group.reasons.join('; ')}` : 'APPLY'}`,
      ].join('\n'),
    )
    .join('\n\n');
  return `${groups}\nGlobal exclusions / zero-website organizations / bootstrap invitations:\n${canonical(plan.excluded)}\n`;
}

async function lockGroups(tx: Db, ids: string[]) {
  await tx.$queryRaw(Prisma.sql`SELECT id FROM organization WHERE id IN (${Prisma.join([...ids].sort())}) ORDER BY id FOR UPDATE`);
}
async function writeRow(tx: Db, table: string, row: Row | null, identity: Row) {
  const keys = primaryKeys[table];
  if (!keys) throw new Error(`Unjournalled table ${table}`);
  const where = Prisma.join(
    keys.map((key) => Prisma.sql`${Prisma.raw(quote(key))} = ${identity[key]}`),
    ' AND ',
  );
  if (!row) {
    await tx.$executeRaw(Prisma.sql`DELETE FROM ${Prisma.raw(quote(table))} WHERE ${where}`);
    return;
  }
  const columns = Object.keys(row);
  const updates = columns.filter((col) => !keys.includes(col));
  await tx.$executeRaw(Prisma.sql`INSERT INTO ${Prisma.raw(quote(table))} (${Prisma.raw(columns.map(quote).join(','))})
    SELECT ${Prisma.raw(columns.map(quote).join(','))} FROM jsonb_populate_record(NULL::${Prisma.raw(quote(table))}, ${JSON.stringify(row)}::jsonb)
    ON CONFLICT (${Prisma.raw(keys.map(quote).join(','))}) DO UPDATE SET ${Prisma.raw(updates.map((col) => `${quote(col)}=EXCLUDED.${quote(col)}`).join(','))}`);
}

// JSONB normalizes object-key order. Record just the key shape, with no leaf
// values, so restoring a legacy JSON string reproduces its original bytes.
function jsonShape(value: any): any {
  if (Array.isArray(value)) return value.map(jsonShape);
  if (value && typeof value === 'object')
    return { keys: Object.keys(value), children: Object.fromEntries(Object.entries(value).map(([key, item]) => [key, jsonShape(item)])) };
  return null;
}
function inOriginalOrder(value: any, shape: any): any {
  if (Array.isArray(value)) return value.map((item, index) => inOriginalOrder(item, shape[index]));
  if (value && typeof value === 'object' && shape?.keys)
    return Object.fromEntries(shape.keys.map((key: string) => [key, inOriginalOrder(value[key], shape.children[key])]));
  return value;
}

// Legacy columns remain for rollback. Reference website-owned copies rather
// than persisting their credentials in the operator undo log.
function journalImage(table: string, row: Row | null, state: Snapshot): Row | null {
  if (!row) return null;
  const image = structuredClone(row);
  if (table === 'project') {
    const { organizationId, ...retained } = row;
    return { id: row.id, organizationId, retainedFingerprint: digest(retained) };
  }
  if (table === 'organization') {
    const meta = json(row.metadata);
    const project = state.project?.find((site) => site.organizationId === row.id || site.dataTenantId === row.id);
    if (Object.keys(meta).some((key) => !['notifications', 'plan', 'entitlements'].includes(key))) {
      if (!project || row.metadata !== JSON.stringify(meta))
        throw new Error('Legacy metadata must have a canonical website-owned copy before merging');
      const safe: Row = {};
      const refs: Row = {};
      for (const [key, value] of Object.entries(meta)) {
        if (['notifications', 'plan', 'entitlements'].includes(key)) safe[key] = value;
        else refs[key] = { projectId: project.id, fingerprint: digest(value), shape: jsonShape(value) };
      }
      image.metadata = { safe, refs, order: Object.keys(meta) };
    }
  }
  if (table === 'organization_git_webhook_secret') {
    const project = state.project?.find((site) => site.organizationId === row.organizationId || site.dataTenantId === row.organizationId);
    if (!project) throw new Error('Legacy webhook secret has no website copy');
    image.secret = { projectId: project.id, fingerprint: digest(row.secret) };
  }
  return image;
}
async function hydrate(tx: Db, table: string, image: Row | null): Promise<Row | null> {
  if (!image) return null;
  const row = structuredClone(image);
  if (table === 'project') {
    const [current] = await tx.$queryRaw<Array<{ row: Row }>>`SELECT to_jsonb(p) AS row FROM project p WHERE id=${row.id}`;
    if (!current) throw new Error('Website was deleted');
    const { organizationId: _, ...retained } = current.row;
    if (digest(retained) !== row.retainedFingerprint) throw new Error('Website after-image drift');
    return { ...current.row, organizationId: row.organizationId };
  }
  if (table === 'organization' && row.metadata && typeof row.metadata === 'object') {
    const { safe, refs, order } = row.metadata;
    const values: Row = { ...safe };
    for (const [key, ref] of Object.entries(refs) as Array<[string, Row]>) {
      if (key === 'git') {
        const settings = await tx.projectGitSettings.findUniqueOrThrow({ where: { projectId: ref.projectId } });
        const secret = await tx.projectGitWebhookSecret.findUnique({ where: { projectId: ref.projectId } });
        values[key] = { ...(settings.settings as Row), ...(secret ? { webhookSecret: secret.secret } : {}) };
        if (digest(values[key]) !== ref.fingerprint) delete values[key].webhookSecret;
      } else {
        const settings = await tx.projectLegacySettings.findUniqueOrThrow({ where: { projectId: ref.projectId } });
        values[key] = (settings.metadata as Row)[key];
      }
      if (digest(values[key]) !== ref.fingerprint) throw new Error(`Website legacy settings changed: ${key}`);
      values[key] = inOriginalOrder(values[key], ref.shape);
    }
    row.metadata = JSON.stringify(Object.fromEntries(order.map((key: string) => [key, values[key]])));
  }
  if (table === 'organization_git_webhook_secret' && typeof row.secret === 'object') {
    const secret = await tx.projectGitWebhookSecret.findUniqueOrThrow({ where: { projectId: row.secret.projectId } });
    if (digest(secret.secret) !== row.secret.fingerprint) throw new Error('Webhook copy changed');
    row.secret = secret.secret;
  }
  return row;
}

async function journal(tx: Db, runId: string, groupKey: string, table: string, id: string, before: Row | null, after: Row | null) {
  await tx.$executeRaw`INSERT INTO org_merge_journal(run_id,group_key,table_name,row_id,before,after)
    VALUES (${runId},${groupKey},${table},${id},${before ? JSON.stringify(before) : null}::jsonb,${after ? JSON.stringify(after) : null}::jsonb)`;
}

export async function applyMerge(plan: MergePlan, options: { db?: typeof prisma; quota?: QuotaStore } = {}) {
  if (plan.version !== 1 || !plan.runId || !Array.isArray(plan.groups)) throw new Error('Invalid merge plan');
  const db = options.db ?? prisma;
  const results: Array<{ groupKey: string; status: string; reason?: string }> = [];
  // A dedicated lock transaction keeps one connection for the run. Each group
  // commits independently on a second connection, as the operator contract requires.
  await db.$transaction(
    async (lockTx) => {
      await lockTx.$queryRaw`SELECT pg_advisory_xact_lock(813455,2)::text`;
      for (const input of plan.groups) {
        try {
          const result = await db.$transaction(
            async (tx) => {
              const done = await tx.$queryRaw<
                Row[]
              >`SELECT table_name,after FROM org_merge_journal WHERE run_id=${plan.runId} AND group_key=${input.key} AND table_name IN ('@group','@restored')`;
              if (done.length) {
                return {
                  groupKey: input.key,
                  status: done[0]?.table_name === '@restored' ? 'already restored; create a new plan' : 'already applied',
                };
              }
              await lockGroups(tx, input.orgIds);
              const before = await snapshot(tx, input.orgIds);
              if (digest(before) !== input.digest) {
                return { groupKey: input.key, status: 'skipped', reason: 'input digest drift' };
              }
              const group = makeGroup(before, input.ownerId, new Date().toISOString().slice(0, 10), input.decision);
              if (group.reasons.length) {
                return { groupKey: input.key, status: 'skipped', reason: group.reasons.join('; ') };
              }
              if (
                canonical(input.after) !== canonical(group.after) ||
                input.survivorId !== group.survivorId ||
                input.name !== group.name ||
                input.slug !== group.slug
              )
                throw new Error('Plan permission/name/handle mismatch');
              if (!options.quota) throw new Error('Quota adapter required for apply (inject a no-op only when drafting is disabled)');
              const after = transformed(before, group);
              await tx.$executeRaw`SELECT set_config('nibleaf.org_merge_restore','on',true)`;
              await tx.$executeRaw`SET CONSTRAINTS ALL DEFERRED`;
              // Organization.slug has a non-deferrable unique index. Free the
              // source mirror before selecting its handle on the survivor.
              await tx.$executeRaw`UPDATE organization SET slug=${`org-merge-${randomUUID()}`} WHERE id<>${group.survivorId} AND slug=${group.slug}`;
              for (const table of moveOrder) {
                const oldRows = byKey(table, before[table] ?? []),
                  newRows = byKey(table, after[table] ?? []);
                if (table === 'organization_handle')
                  await tx.$executeRaw(
                    Prisma.sql`UPDATE organization_handle SET current=false WHERE "organizationId" IN (${Prisma.join(group.orgIds)})`,
                  );
                for (const [id, row] of newRows) {
                  const old = oldRows.get(id) ?? null;
                  if (canonical(old) === canonical(row) && table !== 'organization_handle') continue;
                  await writeRow(tx, table, row, row);
                  await journal(tx, plan.runId, group.key, table, id, journalImage(table, old, before), journalImage(table, row, after));
                }
              }
              for (const table of ['organization_git_webhook_secret', 'member', 'organization_usage_plan', 'organization']) {
                const oldRows = byKey(table, before[table] ?? []),
                  newRows = byKey(table, after[table] ?? []);
                for (const [id, row] of oldRows)
                  if (!newRows.has(id)) {
                    await journal(tx, plan.runId, group.key, table, id, journalImage(table, row, before), null);
                    await writeRow(tx, table, null, row);
                  }
              }
              await tx.$executeRaw`SET CONSTRAINTS ALL IMMEDIATE`;
              const actual = await snapshot(tx, group.orgIds);
              if (canonical(permissions(actual)) !== canonical(group.after)) throw new Error('Post-merge permissions differ from plan');
              for (const table of ['usage_storage_marker', 'usage_ingest_checkpoint', 'usage_provider_checkpoint'])
                if (canonical(actual[table]) !== canonical(before[table])) throw new Error(`Usage rows changed: ${table}`);
              await journal(tx, plan.runId, group.key, '@group', group.key, { digest: input.digest }, { group, afterDigest: digest(actual) });
              await options.quota.merge(`${plan.runId}:${group.key}`, group.quota.keys, group.quota.survivorKey);
              return { groupKey: group.key, status: 'applied' };
            },
            { timeout: 120_000 },
          );
          results.push(result);
        } catch (error) {
          results.push({ groupKey: input.key, status: 'failed', reason: error instanceof Error ? error.message : 'merge failed' });
        }
      }
    },
    { timeout: 300_000 },
  );
  return results;
}

export async function verifyMerge(runId: string, db = prisma) {
  return db.$transaction(
    async (tx) => {
      const entries = await tx.$queryRaw<Row[]>`SELECT after FROM org_merge_journal WHERE run_id=${runId} AND table_name='@group' ORDER BY seq`;
      if (!entries.length) throw new Error('Unknown or restored run');
      const results: Array<{ groupKey: string; status: string; reason?: string }> = [];
      for (const entry of entries) {
        const group = entry.after.group as MergeGroup;
        const live = await snapshot(tx, group.orgIds);
        if (canonical(permissions(live)) !== canonical(group.after)) throw new Error(`Permission drift: ${group.key}`);
        const { resolveSiteAccess, assertUsableAccount } = await import('../lib/access');
        for (const person of group.after)
          for (const [projectId, role] of Object.entries(person.websites)) {
            let actual: string | null = null;
            try {
              await assertUsableAccount(person.userId);
              actual = (await resolveSiteAccess(person.userId, projectId)).role;
            } catch (error) {
              if (
                !(
                  error &&
                  typeof error === 'object' &&
                  (('status' in error && error.status === 404) || ('code' in error && error.code === 'auth:invalid_session'))
                )
              )
                throw error;
            }
            if (actual !== role) throw new Error(`Resolver mismatch ${person.userId}/${projectId}`);
          }
        results.push({ groupKey: group.key, status: 'verified' });
      }
      return results;
    },
    { timeout: 120_000 },
  );
}

export async function restoreMerge(runId: string, options: { db?: typeof prisma; offline: boolean }) {
  if (!options.offline) throw new Error('Restore requires ORG_MERGE_OFFLINE=1 and the app stopped');
  const db = options.db ?? prisma;
  return db.$transaction(
    async (tx) => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(813455,2)::text`;
      const entries = await tx.$queryRaw<Row[]>`SELECT * FROM org_merge_journal WHERE run_id=${runId} ORDER BY seq DESC`;
      if (!entries.length) throw new Error('Unknown run');
      const results: Array<{ groupKey: string; status: string; reason?: string }> = [];
      for (const marker of entries.filter((row) => row.table_name === '@group')) {
        await tx.$executeRawUnsafe('SAVEPOINT org_merge_restore');
        const group = marker.after.group as MergeGroup;
        try {
          await lockGroups(tx, group.orgIds);
          const live = await snapshot(tx, group.orgIds);
          if (digest(live) !== marker.after.afterDigest) throw new Error('After-image drift: group changed; restore refused');
          const changes = entries.filter((row) => row.group_key === group.key && row.table_name !== '@group');
          for (const change of changes) {
            const current = byKey(change.table_name, live[change.table_name] ?? []).get(change.row_id) ?? null;
            if (canonical(current) !== canonical(await hydrate(tx, change.table_name, change.after)))
              throw new Error(`After-image drift: ${change.table_name}`);
          }
          await tx.$executeRaw`SET CONSTRAINTS ALL DEFERRED`;
          await tx.$executeRaw`SELECT set_config('nibleaf.org_merge_restore','on',true)`;
          await tx.$executeRaw(Prisma.sql`UPDATE organization_handle SET current=false WHERE \"organizationId\" IN (${Prisma.join(group.orgIds)})`);
          await tx.$executeRaw`UPDATE organization SET slug=${`org-restore-${randomUUID()}`} WHERE id=${group.survivorId}`;
          for (const change of changes) {
            const row = await hydrate(tx, change.table_name, change.before);
            const identity = row ?? (await hydrate(tx, change.table_name, change.after));
            if (identity) await writeRow(tx, change.table_name, row, identity);
          }
          await tx.$executeRaw`SET CONSTRAINTS ALL IMMEDIATE`;
          if (digest(await snapshot(tx, group.orgIds)) !== marker.before.digest) throw new Error('Restored input digest differs');
          await tx.$executeRaw`DELETE FROM org_merge_journal WHERE run_id=${runId} AND group_key=${group.key}`;
          await journal(tx, runId, group.key, '@restored', group.key, null, { restored: true });
          results.push({ groupKey: group.key, status: 'restored' });
        } catch (error) {
          await tx.$executeRawUnsafe('ROLLBACK TO SAVEPOINT org_merge_restore');
          results.push({ groupKey: group.key, status: 'refused', reason: error instanceof Error ? error.message : 'restore failed' });
        }
        await tx.$executeRawUnsafe('RELEASE SAVEPOINT org_merge_restore');
      }
      return results;
    },
    { timeout: 300_000 },
  );
}

export async function redisQuota(): Promise<QuotaStore & { close(): Promise<void> }> {
  const { Redis } = await import('ioredis');
  const { keys } = await import('@nibleaf/bullmq/keys');
  const env = keys();
  const client = new Redis({ host: env.REDIS_HOST, port: env.REDIS_PORT, db: env.REDIS_DB, password: env.REDIS_PASSWORD, maxRetriesPerRequest: 1 });
  return {
    async merge(runId, sourceKeys, survivorKey) {
      await client.eval(
        `if redis.call('EXISTS',KEYS[#KEYS]) == 1 then return 0 end
        local total=0
        for i=1,#KEYS-1 do local v=redis.call('GET',KEYS[i]); if v and not string.match(v,'^%d+$') then return redis.error_reply('invalid quota') end; total=total+tonumber(v or '0') end
        local ttl=redis.call('TTL',ARGV[1]); if ttl < 0 then ttl=86400 end
        redis.call('SET',ARGV[1],total,'EX',ttl); redis.call('SET',KEYS[#KEYS],1,'EX',172800); return total`,
        sourceKeys.length + 1,
        ...sourceKeys,
        `nibleaf:org-merge-quota:${runId}`,
        survivorKey,
      );
    },
    async close() {
      await client.quit();
    },
  };
}

async function main() {
  const args = process.argv.slice(2).filter((arg) => arg !== '--');
  const [command, value] = args;
  try {
    if (command === 'plan') {
      const plan = await planMerge();
      const output = args.includes('--out') ? args[args.indexOf('--out') + 1] : `org-merge-${plan.runId}.json`;
      if (!output) throw new Error('--out requires a file');
      await writeFile(output, `${JSON.stringify(plan, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
      console.log(humanReport(plan));
      console.log(`Plan: ${output}`);
    } else if (command === 'apply' && value) {
      const quota =
        process.env.ORG_MERGE_DRAFT_AI_DISABLED === '1' ? { merge: async () => undefined, close: async () => undefined } : await redisQuota();
      try {
        const results = await applyMerge(JSON.parse(await readFile(value, 'utf8')), { quota });
        console.log(results);
        if (results.some((row) => row.status === 'failed')) process.exitCode = 1;
      } finally {
        await quota.close();
      }
    } else if (command === 'verify' && value) console.log(await verifyMerge(value));
    else if (command === 'restore' && value) {
      const results = await restoreMerge(value, { offline: process.env.ORG_MERGE_OFFLINE === '1' });
      console.log(results);
      if (results.some((row) => row.status === 'refused')) process.exitCode = 1;
    } else throw new Error('Usage: org:merge -- plan [--out file] | apply <planFile> | verify <runId> | restore <runId>');
  } finally {
    await prisma.$disconnect();
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
