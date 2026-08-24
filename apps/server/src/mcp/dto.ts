import { listBranches } from '@/actions/branches';
import { getDeployment, getPendingChanges, listDeployments } from '@/actions/deployments';
import { getExport, listExports } from '@/actions/exports';
import { listLanguages } from '@/actions/languages';
import { getPage, listPages } from '@/actions/pages';
import { getProject } from '@/actions/projects';

const iso = (value: Date | null | undefined) => value?.toISOString() ?? null;

export const getProjectDto = async (organizationId: string, projectId: string) => {
  const project = await getProject(organizationId, projectId);
  return {
    id: project.id,
    name: project.name,
    slug: project.slug,
    description: project.description,
    icon: project.icon,
    counts: { pages: project._count.pages, deployments: project._count.deployments, domains: project._count.domains },
    languages: project.languages.map((language) => ({
      id: language.id,
      code: language.code,
      label: language.label,
      direction: language.direction,
      enabled: language.enabled,
      isDefault: language.isDefault,
      position: language.position,
    })),
    createdAt: project.createdAt.toISOString(),
    updatedAt: project.updatedAt.toISOString(),
  };
};

export const listPageDtos = async (projectId: string, languageId?: string, versionId?: string) =>
  (await listPages(projectId, languageId, versionId)).map((page) => ({
    id: page.id,
    parentId: page.parentId,
    versionId: page.branchId,
    languageId: page.languageId,
    kind: page.kind,
    title: page.title,
    slug: page.slug,
    path: page.path,
    icon: page.icon,
    description: page.description,
    translationKey: page.translationKey,
    position: page.position,
    hidden: page.hidden,
    updatedAt: page.updatedAt.toISOString(),
  }));

export const getPageDto = async (projectId: string, pageId: string) => {
  const page = await getPage(projectId, pageId);
  return {
    id: page.id,
    parentId: page.parentId,
    versionId: page.branchId,
    languageId: page.languageId,
    kind: page.kind,
    title: page.title,
    slug: page.slug,
    path: page.path,
    icon: page.icon,
    description: page.description,
    content: page.content,
    translationKey: page.translationKey,
    position: page.position,
    hidden: page.hidden,
    createdAt: page.createdAt.toISOString(),
    updatedAt: page.updatedAt.toISOString(),
  };
};

export const listLanguageDtos = async (projectId: string) =>
  (await listLanguages(projectId)).map((language) => ({
    id: language.id,
    code: language.code,
    label: language.label,
    direction: language.direction,
    enabled: language.enabled,
    isDefault: language.isDefault,
    position: language.position,
    createdAt: language.createdAt.toISOString(),
    updatedAt: language.updatedAt.toISOString(),
  }));

export const listVersionDtos = async (projectId: string) =>
  (await listBranches(projectId)).map((branch) => ({
    versionId: branch.id,
    name: branch.name,
    isDefault: branch.isDefault,
    createdAt: branch.createdAt.toISOString(),
    updatedAt: branch.updatedAt.toISOString(),
  }));

export const listExportDtos = async (projectId: string) =>
  (await listExports(projectId)).map((job) => ({
    id: job.id,
    formats: job.formats,
    status: job.status,
    trigger: job.trigger,
    attempts: job.attempts,
    errorCode: job.error ? 'export_failed' : null,
    snapshot: {
      deploymentVersion: job.snapshot.deploymentVersion,
      pagesCount: job.snapshot.pagesCount,
      createdAt: job.snapshot.createdAt.toISOString(),
    },
    schedule: job.schedule,
    artifacts: job.artifacts.map((artifact) => ({
      id: artifact.id,
      format: artifact.format,
      fileName: artifact.fileName,
      contentType: artifact.contentType,
      size: artifact.size,
      createdAt: artifact.createdAt.toISOString(),
    })),
    createdAt: job.createdAt.toISOString(),
    startedAt: iso(job.startedAt),
    completedAt: iso(job.completedAt),
    expiresAt: iso(job.expiresAt),
  }));

export const getExportDto = async (projectId: string, exportId: string) => {
  const job = await getExport(projectId, exportId);
  return {
    id: job.id,
    formats: job.formats,
    status: job.status,
    trigger: job.trigger,
    attempts: job.attempts,
    errorCode: job.error ? 'export_failed' : null,
    snapshot: {
      deploymentVersion: job.snapshot.deploymentVersion,
      pagesCount: job.snapshot.pagesCount,
      createdAt: job.snapshot.createdAt.toISOString(),
    },
    schedule: job.schedule,
    artifacts: job.artifacts.map((artifact) => ({
      id: artifact.id,
      format: artifact.format,
      fileName: artifact.fileName,
      contentType: artifact.contentType,
      size: artifact.size,
      createdAt: artifact.createdAt.toISOString(),
    })),
    createdAt: job.createdAt.toISOString(),
    startedAt: iso(job.startedAt),
    completedAt: iso(job.completedAt),
    expiresAt: iso(job.expiresAt),
  };
};

export const listDeploymentDtos = async (projectId: string) =>
  (await listDeployments(projectId)).map((deployment) => ({
    id: deployment.id,
    version: deployment.version,
    status: deployment.status,
    pagesCount: deployment.pagesCount,
    commitMessage: deployment.commitMessage,
    errorCode: deployment.error ? 'deployment_failed' : null,
    createdAt: deployment.createdAt.toISOString(),
    completedAt: iso(deployment.completedAt),
  }));

export const getDeploymentDto = async (projectId: string, deploymentId: string) => {
  const deployment = await getDeployment(projectId, deploymentId);
  return {
    id: deployment.id,
    version: deployment.version,
    status: deployment.status,
    pagesCount: deployment.pagesCount,
    commitMessage: deployment.commitMessage,
    errorCode: deployment.error ? 'deployment_failed' : null,
    createdAt: deployment.createdAt.toISOString(),
    completedAt: iso(deployment.completedAt),
  };
};

export const getLatestDeploymentDto = async (projectId: string) => {
  const deployment = (await listDeployments(projectId)).find((item) => item.status === 'READY');
  return deployment
    ? {
        id: deployment.id,
        version: deployment.version,
        status: deployment.status,
        pagesCount: deployment.pagesCount,
        commitMessage: deployment.commitMessage,
        errorCode: null,
        createdAt: deployment.createdAt.toISOString(),
        completedAt: iso(deployment.completedAt),
      }
    : null;
};

export const getPendingChangesDto = async (projectId: string) => {
  const pending = await getPendingChanges(projectId);
  return {
    hasBaseline: pending.hasBaseline,
    lastVersion: pending.lastVersion,
    lastPublishedAt: pending.lastPublishedAt,
    changes: pending.changes.map(({ lines: _lines, ...change }) => change),
    redirectIssues: { count: pending.redirectIssues.length, blocking: pending.redirectIssues.length > 0 },
  };
};
