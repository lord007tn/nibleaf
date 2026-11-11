import { createFileRoute, lazyRouteComponent } from '@tanstack/react-router';
import { publishHistoryDetailQueryOptions } from '@/hooks/api/publish-history';
import { prefetchRouteData } from '@/integrations/tanstack-query/query-client';

const PublishVersionPage = lazyRouteComponent(() => import('@/components/publishes/publish-version-page'));

export const Route = createFileRoute('/app/projects/$projectId/publishes/$deploymentId')({
  loader: ({ context: { queryClient }, params: { projectId, deploymentId } }) => {
    prefetchRouteData(queryClient, publishHistoryDetailQueryOptions(projectId, deploymentId));
  },
  // Method shorthand keeps the component out of the route tree's eager chunk.
  component() {
    // biome-ignore lint/correctness/useHookAtTopLevel: `component` is rendered as a React component.
    const { projectId, deploymentId } = Route.useParams();
    return <PublishVersionPage deploymentId={deploymentId} projectId={projectId} />;
  },
});
