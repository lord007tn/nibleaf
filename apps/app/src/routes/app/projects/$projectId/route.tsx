import { createFileRoute, Outlet } from '@tanstack/react-router';
import { ProjectAccessBoundary } from '@/components/project/project-access-boundary';
import {
  branchesQueryOptions,
  deploymentsQueryOptions,
  languagesQueryOptions,
  pagesQueryOptions,
  projectQueryOptions,
} from '@/hooks/api/query-options';
import { prefetchRouteData } from '@/integrations/tanstack-query/query-client';
import { ProjectLayout } from '@/layouts/project';

export const Route = createFileRoute('/app/projects/$projectId')({
  // Every site screen (overview, editor, settings…) needs these, so start them on
  // link hover instead of after the shell mounts. Non-blocking: the skeleton shows
  // straight away. See apps/app/DATA_LOADING.md.
  loader: ({ context: { queryClient }, params: { projectId } }) => {
    prefetchRouteData(queryClient, projectQueryOptions(projectId));
    prefetchRouteData(queryClient, languagesQueryOptions(projectId));
    prefetchRouteData(queryClient, branchesQueryOptions(projectId));
    prefetchRouteData(queryClient, pagesQueryOptions(projectId));
    prefetchRouteData(queryClient, deploymentsQueryOptions(projectId));
  },
  component: ProjectRoute,
});

function ProjectRoute() {
  const { projectId } = Route.useParams();
  return (
    <ProjectAccessBoundary projectId={projectId}>
      <ProjectLayout projectId={projectId}>
        <Outlet />
      </ProjectLayout>
    </ProjectAccessBoundary>
  );
}
