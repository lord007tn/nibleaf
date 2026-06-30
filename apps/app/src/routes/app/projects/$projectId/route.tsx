import { createFileRoute, Outlet } from '@tanstack/react-router';
import { ProjectLayout } from '@/layouts/project';

export const Route = createFileRoute('/app/projects/$projectId')({
  component: ProjectRoute,
});

function ProjectRoute() {
  const { projectId } = Route.useParams();
  return (
    <ProjectLayout projectId={projectId}>
      <Outlet />
    </ProjectLayout>
  );
}

