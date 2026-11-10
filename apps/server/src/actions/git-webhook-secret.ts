import { randomBytes } from 'node:crypto';
import { prisma } from '@nibleaf/database';
import { lockProjectSettings } from './project-settings-storage';

export const generateWebhookSecret = (): string => randomBytes(32).toString('hex');

/** The migration copies legacy secrets exactly. Reads never follow a mutable
 * organization pointer, so moving a website preserves signature verification. */
export const readGitWebhookSecret = async (projectId: string) => {
  const row = await prisma.projectGitWebhookSecret.findUnique({ where: { projectId }, select: { secret: true } });
  return { projectId, secret: row?.secret ?? null };
};

export const getGitWebhookSecret = async (projectId: string): Promise<string | null> => (await readGitWebhookSecret(projectId)).secret;

/** Explicit admin rotation only; migration/settings saves never mint a secret.
 * The org table is a rollout mirror until the contract PR removes dual writes. */
export const rotateGitWebhookSecret = async (projectId: string): Promise<string> => {
  const secret = generateWebhookSecret();
  await prisma.$transaction(async (tx) => {
    const project = await lockProjectSettings(tx, projectId);
    await tx.projectGitWebhookSecret.upsert({ where: { projectId }, create: { projectId, secret }, update: { secret } });
    await tx.organizationGitWebhookSecret.upsert({
      where: { organizationId: project.organizationId },
      create: { organizationId: project.organizationId, secret },
      update: { secret },
    });
  });
  return secret;
};
