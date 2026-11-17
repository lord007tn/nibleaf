import { useQueryClient } from '@tanstack/react-query';
import { type ReactNode, useEffect } from 'react';
import { DashboardProblem } from '@/components/app/dashboard-problem';
import { useAccessLoss } from '@/components/organization/use-access-loss';
import { type Project, useOrganizationOfProject, useProject } from '@/hooks/api';
import { ApiResponseError } from '@/hooks/api/client-helpers';
import { queryKeys } from '@/hooks/api/query-keys';
import { SitePageSkeleton } from './site-page-skeleton';

/** Do not mount project tools until access has been resolved. A revoked
 * membership must also hide cached project data; a transient background error
 * should leave an already-open editor and its unsaved draft mounted. */
export function ProjectAccessBoundary({ projectId, children }: { projectId: string; children: ReactNode }) {
  const { data: project, error, isPending, isFetching, refetch } = useProject(projectId);
  const unavailable = error instanceof ApiResponseError && [401, 403, 404].includes(error.status);
  // Losing access while looking (§5.4.6): if we knew this website, say so and go to its
  // org's Websites. The name comes from the client cache, never from the server.
  const cachedProjects = useQueryClient().getQueryData<Project[]>(queryKeys.projects.all());
  const known = project ?? cachedProjects?.find((site) => site.id === projectId);
  const { organization } = useOrganizationOfProject(known?.organizationId);
  const { lostWebsite } = useAccessLoss();
  const lostName = unavailable ? known?.name : undefined;
  useEffect(() => {
    if (lostName) lostWebsite(lostName, organization?.slug);
  }, [lostName, organization?.slug, lostWebsite]);

  if (project && !unavailable) return children;
  if (lostName) return <SitePageSkeleton />;
  if (isPending) return <SitePageSkeleton />;

  const missing = unavailable || !error;
  return missing ? <DashboardProblem /> : <DashboardProblem kind="error" retry={{ onRetry: () => void refetch(), retrying: isFetching }} />;
}
