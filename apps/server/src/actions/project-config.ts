import type { Prisma } from '@nibleaf/database';
import { z } from 'zod';
import { conflict, notFound } from '@/errors';

const CONFIG_WRITE_ATTEMPTS = 4;
const projectConfigRecordSchema = z.record(z.string(), z.json()).catch({});

/**
 * Compare-and-swap a derived Project.config value without letting a stale read
 * overwrite concurrently updated sibling sections. Callers can use this inside
 * a wider Prisma transaction when authoritative rows, audit entries, and the
 * compatibility config projection must commit together.
 */
export const mutateProjectConfig = async (
  tx: Prisma.TransactionClient,
  organizationId: string,
  projectId: string,
  createNext: (current: Record<string, unknown>) => Record<string, unknown>,
) => {
  for (let attempt = 0; attempt < CONFIG_WRITE_ATTEMPTS; attempt += 1) {
    const current = await tx.project.findFirst({
      where: { id: projectId, organizationId },
      select: { config: true, updatedAt: true },
    });
    if (!current) throw notFound('project', { id: projectId });

    const next = projectConfigRecordSchema.parse(createNext(projectConfigRecordSchema.parse(current.config)));
    const updated = await tx.project.updateManyAndReturn({
      where: { id: projectId, organizationId, updatedAt: current.updatedAt },
      data: { config: next },
      select: { id: true, config: true, updatedAt: true },
    });
    const project = updated[0];
    if (project) return project;
  }

  throw conflict('Project configuration changed repeatedly. Retry the update.', { projectId });
};
