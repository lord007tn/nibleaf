import { createJob, QueueNames } from '@plume/bullmq';
import { Prisma, prisma } from '@plume/database';
import type { CreateDeploymentBody } from '@plume/validators';
import { badRequest, notFound } from '@/errors';
import { assertProjectInOrg } from './projects';

export const listDeployments = (projectId: string) =>
  prisma.deployment.findMany({ where: { projectId }, orderBy: { version: 'desc' }, take: 50 });

export const getDeployment = async (projectId: string, id: string) => {
  const deployment = await prisma.deployment.findFirst({ where: { id, projectId } });
  if (!deployment) {
    throw notFound('deployment', { id });
  }
  return deployment;
};

export const getLatestReadyDeployment = (projectId: string) =>
  prisma.deployment.findFirst({ where: { projectId, status: 'READY' }, orderBy: { version: 'desc' } });

/** Create a PENDING deployment and enqueue the publish job for the worker to build. */
export const createDeployment = async (organizationId: string, projectId: string, userId: string, body: CreateDeploymentBody) => {
  await assertProjectInOrg(organizationId, projectId);
  const last = await prisma.deployment.aggregate({ where: { projectId }, _max: { version: true } });
  const version = (last._max.version ?? 0) + 1;
  const deployment = await prisma.deployment.create({
    data: {
      projectId,
      version,
      status: 'PENDING',
      createdById: userId,
      ...(body.message ? { commitMessage: body.message } : {}),
    },
  });
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
  const last = await prisma.deployment.aggregate({ where: { projectId }, _max: { version: true } });
  const version = (last._max.version ?? 0) + 1;
  return prisma.deployment.create({
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
  });
};
