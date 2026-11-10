import { type Prisma, prisma } from '@nibleaf/database';

const parseOrganizationMetadata = (raw: string | null): Record<string, unknown> => {
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
};

export const readProjectGitSettings = async (projectId: string): Promise<Record<string, unknown>> => {
  const row = await prisma.projectGitSettings.findUnique({ where: { projectId }, select: { settings: true } });
  return (row?.settings ?? {}) as Record<string, unknown>;
};

/** Org first, then project: matches ownership moves and organization erasure. */
export const lockProjectSettings = async (tx: Prisma.TransactionClient, projectId: string) => {
  const rows = await tx.$queryRaw<Array<{ organizationId: string }>>`
  SELECT o.id AS "organizationId" FROM organization o JOIN project p ON p."organizationId" = o.id
  WHERE p.id = ${projectId} FOR NO KEY UPDATE OF o`;
  const project = rows[0];
  if (!project) throw new Error('Project not found.');
  const locked = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM project
  WHERE id = ${projectId} AND "organizationId" = ${project.organizationId} FOR UPDATE`;
  if (!locked[0]) throw new Error('Project moved; retry settings update.');
  return project;
};

/** Serialize read/modify/write and the legacy mirror with the project move.
 * Unknown site metadata remains server-only and is never folded into a DTO. */
export const writeProjectSettings = async (
  projectId: string,
  change: (current: { git: Record<string, unknown>; legacy: Record<string, unknown> }) => {
    git: Record<string, unknown>;
    legacy: Record<string, unknown>;
  },
) =>
  prisma.$transaction(async (tx) => {
    const project = await lockProjectSettings(tx, projectId);
    const [git, legacy, org] = await Promise.all([
      tx.projectGitSettings.findUnique({ where: { projectId } }),
      tx.projectLegacySettings.findUnique({ where: { projectId } }),
      tx.organization.findUniqueOrThrow({ where: { id: project.organizationId }, select: { metadata: true } }),
    ]);
    const next = change({ git: (git?.settings ?? {}) as Record<string, unknown>, legacy: (legacy?.metadata ?? {}) as Record<string, unknown> });
    const { webhookSecret: _secret, ...safeGit } = next.git;
    const settings = JSON.parse(JSON.stringify(safeGit)) as Prisma.InputJsonObject;
    const metadata = JSON.parse(JSON.stringify(next.legacy)) as Prisma.InputJsonObject;
    await tx.projectGitSettings.upsert({ where: { projectId }, create: { projectId, settings }, update: { settings } });
    await tx.projectLegacySettings.upsert({ where: { projectId }, create: { projectId, metadata }, update: { metadata } });
    // Rollout mirror only. Website reads exclusively use the project rows above.
    const old = parseOrganizationMetadata(org.metadata);
    const oldGit = old.git as Record<string, unknown> | undefined;
    const mirrorGit = { ...settings, ...(oldGit?.webhookSecret ? { webhookSecret: oldGit.webhookSecret } : {}) };
    await tx.organization.update({
      where: { id: project.organizationId },
      data: { metadata: JSON.stringify({ ...old, ...metadata, git: mirrorGit }) },
    });
  });
