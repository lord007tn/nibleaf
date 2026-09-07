import { createFileRoute, Outlet } from '@tanstack/react-router';
import { ProjectAccessBoundary } from '@/components/project/project-access-boundary';
import { ProjectLayout } from '@/layouts/project';

export const Route = createFileRoute('/app/projects/$projectId')({
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
