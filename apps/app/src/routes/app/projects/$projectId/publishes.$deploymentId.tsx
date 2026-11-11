import { createFileRoute } from '@tanstack/react-router';
import PublishVersionPage from '@/components/publishes/publish-version-page';
import { publishHistoryDetailQueryOptions } from '@/hooks/api/publish-history';
import { prefetchRouteData } from '@/integrations/tanstack-query/query-client';

export const Route = createFileRoute('/app/projects/$projectId/publishes/$deploymentId')({
  loader: ({ context: { queryClient }, params: { projectId, deploymentId } }) => {
    prefetchRouteData(queryClient, publishHistoryDetailQueryOptions(projectId, deploymentId));
  },
  // A component imported as is: the code splitter moves it (and its imports)
  // out of the route tree, which every page, published docs included, loads.
  component: PublishVersionPage,
});
