import { randomBytes } from 'node:crypto';
import { type Prisma, prisma } from '@nibleaf/database';
import { logger } from '@nibleaf/logger';

/**
 * The one-way push-to-deploy webhook secret is server-only. It is stored in
 * `organization_git_webhook_secret`, never in `organization.metadata`: the auth
 * organization endpoints return metadata to every member of the organization.
 *
 * Older installs kept the secret at `metadata.git.webhookSecret`. The data
 * migration moves it. Any copy still found in metadata is moved here:
 *
 * - The table is the source of truth. A copy is adopted only when no stored
 *   secret exists, and adoption commits together with the metadata cleanup.
 * - The cleanup removes only that field. It parses the metadata in the API
 *   (so it also works for text PostgreSQL cannot cast to jsonb) and writes it
 *   back only if the stored text is still the text it parsed, so it never
 *   overwrites a concurrent metadata write.
 * - When a stored secret already exists, a failed cleanup is logged and does
 *   not fail the request.
 */

const LEGACY_FIELD = 'webhookSecret';
/** Compare-and-set attempts before a cleanup gives up on a busy metadata value. */
const STRIP_ATTEMPTS = 3;

type Client = Prisma.TransactionClient | typeof prisma;

/** 32 random bytes as hex — the shared webhook secret for one project's org. */
export const generateWebhookSecret = (): string => randomBytes(32).toString('hex');

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

const parseMetadata = (raw: string | null | undefined): Record<string, unknown> | null => {
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
};

/** A metadata copy of the secret: whether the field exists, and its usable value. */
interface LegacyCopy {
  present: boolean;
  value: string | null;
}

const legacyCopyIn = (git: unknown): LegacyCopy => {
  if (!(isRecord(git) && LEGACY_FIELD in git)) return { present: false, value: null };
  const value = git[LEGACY_FIELD];
  return { present: true, value: typeof value === 'string' && value.length > 0 ? value : null };
};

/**
 * Remove the field from the organization's current metadata. Returns true when
 * no copy remains, false when the value kept changing underneath.
 */
const stripLegacyCopy = async (client: Client, organizationId: string): Promise<boolean> => {
  for (let attempt = 0; attempt < STRIP_ATTEMPTS; attempt++) {
    const org = await client.organization.findUnique({ where: { id: organizationId }, select: { metadata: true } });
    const raw = org?.metadata ?? null;
    const metadata = parseMetadata(raw);
    if (!(metadata && legacyCopyIn(metadata.git).present)) return true;
    delete (metadata.git as Record<string, unknown>)[LEGACY_FIELD];
    // Written only over the exact text parsed above.
    const written = await client.organization.updateMany({
      where: { id: organizationId, metadata: raw },
      data: { metadata: JSON.stringify(metadata) },
    });
    if (written.count === 1) return true;
  }
  return false;
};

/** Cleanup after the stored secret is settled: failures are logged, never thrown. */
const stripLegacyCopyBestEffort = async (organizationId: string): Promise<void> => {
  const stripped = await stripLegacyCopy(prisma, organizationId).catch(() => false);
  if (!stripped) logger.warn({ organizationId }, 'Could not remove a Git webhook secret from organization metadata; it will be retried.');
};

class CopyNotRemoved extends Error {}

/**
 * Move a metadata copy into server-only storage and remove it from metadata.
 * Returns the stored secret, or null when no secret could be stored.
 */
const settleLegacyCopy = async (organizationId: string, copy: LegacyCopy): Promise<string | null> => {
  if (!copy.present) return null;
  const existing = await prisma.organizationGitWebhookSecret.findUnique({ where: { organizationId }, select: { secret: true } });
  const legacy = copy.value;
  if (existing || !legacy) {
    if (existing && legacy && existing.secret !== legacy) {
      logger.warn({ organizationId }, 'Discarded a Git webhook secret found in organization metadata; the stored secret is kept.');
    }
    await stripLegacyCopyBestEffort(organizationId);
    return existing?.secret ?? null;
  }

  // Adoption and cleanup commit together, or neither does.
  try {
    return await prisma.$transaction(async (tx) => {
      const row = await tx.organizationGitWebhookSecret.upsert({
        where: { organizationId },
        create: { organizationId, secret: legacy },
        update: {},
        select: { secret: true },
      });
      if (!(await stripLegacyCopy(tx, organizationId))) throw new CopyNotRemoved();
      return row.secret;
    });
  } catch (error) {
    if (!(error instanceof CopyNotRemoved)) throw error;
    logger.warn({ organizationId }, 'Could not move a Git webhook secret out of organization metadata; it will be retried.');
    return null;
  }
};

/**
 * Move a metadata copy of the secret into server-only storage before the
 * caller writes the metadata document back. Removes the field from `metadata`
 * once a stored secret exists; an unusable copy is always removed.
 */
export const moveLegacyWebhookSecret = async (organizationId: string, metadata: Record<string, unknown>): Promise<void> => {
  const copy = legacyCopyIn(metadata.git);
  if (!copy.present) return;
  const stored = await settleLegacyCopy(organizationId, copy);
  // Never drop the only copy of a secret that could not be stored.
  if (stored || !copy.value) delete (metadata.git as Record<string, unknown>)[LEGACY_FIELD];
};

/** Move a copy found in already-loaded `metadata.git` settings. */
export const settleLegacyWebhookSecretIn = async (organizationId: string, git: unknown): Promise<void> => {
  await settleLegacyCopy(organizationId, legacyCopyIn(git));
};

/** A side-effect-free read of the secret, for callers that must verify before persisting. */
interface GitWebhookSecretRead {
  organizationId: string;
  /** The secret to verify with: the stored one, else a metadata copy. */
  secret: string | null;
  copy: LegacyCopy;
}

export const readGitWebhookSecret = async (organizationId: string): Promise<GitWebhookSecretRead> => {
  const [row, org] = await Promise.all([
    prisma.organizationGitWebhookSecret.findUnique({ where: { organizationId }, select: { secret: true } }),
    prisma.organization.findUnique({ where: { id: organizationId }, select: { metadata: true } }),
  ]);
  const copy = legacyCopyIn(parseMetadata(org?.metadata)?.git);
  return { organizationId, secret: row?.secret ?? copy.value, copy };
};

/** Persist what a read found: move any metadata copy into server-only storage. */
export const settleGitWebhookSecret = async (read: GitWebhookSecretRead): Promise<string | null> => {
  if (!read.copy.present) return read.secret;
  return (await settleLegacyCopy(read.organizationId, read.copy)) ?? read.secret;
};

/** The organization's webhook secret, or null when none is configured. */
export const getGitWebhookSecret = async (organizationId: string): Promise<string | null> =>
  settleGitWebhookSecret(await readGitWebhookSecret(organizationId));

/** Generate (or rotate) the project's webhook secret. Admin-guarded at the route. */
export const rotateGitWebhookSecret = async (organizationId: string): Promise<string> => {
  const secret = generateWebhookSecret();
  await prisma.organizationGitWebhookSecret.upsert({
    where: { organizationId },
    create: { organizationId, secret },
    update: { secret },
  });
  // The rotated secret is the only one accepted from here on; removing any old
  // metadata copy is cleanup and cannot undo the rotation.
  await stripLegacyCopyBestEffort(organizationId);
  return secret;
};
