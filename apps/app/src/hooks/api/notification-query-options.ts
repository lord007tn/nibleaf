import { queryOptions } from '@tanstack/react-query';
import { api } from '@/services/api';
import { getData } from './client-helpers';
import { queryKeys } from './query-keys';

// The bell's unread count, in a module of its own: the /app route loader (in
// the router's eager chunk, which public docs pages load) imports it lazily.
// Its dependencies are already in that chunk, so the lazy import adds no
// shared chunk to the docs first load; importing all of query-options did.
export const unreadNotificationCountQueryOptions = () =>
  queryOptions({
    queryKey: queryKeys.notifications.unreadCount(),
    queryFn: async () => getData(await api.app.notifications['unread-count'].$get(), 'notifications'),
  });
