import { createFileRoute } from '@tanstack/react-router';
import PublishesPage from '@/components/publishes/publishes-page';
import { publishHistoryQueryOptions } from '@/hooks/api/publish-history';

export const Route = createFileRoute('/app/projects/$projectId/publishes/')({
  // Start the first page on navigation (or link hover) without holding it: the
  // list renders its skeleton at once. The site layout already polls publishes.
  loader: ({ context: { queryClient }, params: { projectId } }) => {
    if (typeof window !== 'undefined') void queryClient.prefetchInfiniteQuery(publishHistoryQueryOptions(projectId));
  },
  // A component imported as is: the code splitter moves it (and its imports)
  // out of the route tree, which every page, published docs included, loads.
  component: PublishesPage,
});
