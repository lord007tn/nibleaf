import { prisma } from '@nibleaf/database';
import { deletePrefix } from '@nibleaf/storage';

/** Every per-project object (assets, imported assets, export artifacts) lives under this prefix. */
const projectStoragePrefix = (projectId: string): string => {
  if (!projectId || projectId.includes('/')) throw new TypeError('Project storage erasure requires a single-segment project id.');
  return `projects/${projectId}/`;
};

/**
 * Delete all stored objects of a deleted project. Throws while the project row
 * still exists so the job retries until relational erasure commits; repeated
 * runs are no-ops once the prefix is empty.
 */
export const eraseProjectStorage = async (projectId: string): Promise<number> => {
  const prefix = projectStoragePrefix(projectId);
  const project = await prisma.project.findUnique({ where: { id: projectId }, select: { id: true } });
  if (project) throw new Error('Project still exists; storage erasure waits for relational deletion.');
  return deletePrefix(prefix);
};
