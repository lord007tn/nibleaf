import { createJob, QueueNames } from '@plume/bullmq';
import { Prisma, prisma } from '@plume/database';
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
