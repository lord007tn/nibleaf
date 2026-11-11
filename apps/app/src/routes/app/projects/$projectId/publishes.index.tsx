import { createFileRoute, lazyRouteComponent } from '@tanstack/react-router';
import { publishHistoryQueryOptions } from '@/hooks/api/publish-history';

const PublishesPage = lazyRouteComponent(() => import('@/components/publishes/publishes-page'));

export const Route = createFileRoute('/app/projects/$projectId/publishes/')({
  // Start the first page on navigation (or link hover) without holding it: the
  // list renders its skeleton at once. The site layout already polls publishes.
  loader: ({ context: { queryClient }, params: { projectId } }) => {
    if (typeof window !== 'undefined') void queryClient.prefetchInfiniteQuery(publishHistoryQueryOptions(projectId));
  },
  // Method shorthand keeps the component out of the route tree's eager chunk.
  component() {
    // biome-ignore lint/correctness/useHookAtTopLevel: `component` is rendered as a React component.
    const { projectId } = Route.useParams();
    return <PublishesPage projectId={projectId} />;
  },
});
