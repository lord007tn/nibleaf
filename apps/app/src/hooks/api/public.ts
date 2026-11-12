import { useQuery } from '@tanstack/react-query';
import { getPublicMetaQueryOptions } from './query-options';

type PublicMeta = Awaited<ReturnType<NonNullable<ReturnType<typeof getPublicMetaQueryOptions>['queryFn']>>>;

/** `initialData`: the copy a route loader read for the server-rendered HTML (see `loadRouteData`). */
export const useGetPublicMeta = (options?: { enabled?: boolean; initialData?: PublicMeta | null }) =>
  useQuery({ ...getPublicMetaQueryOptions(), enabled: options?.enabled ?? true, initialData: options?.initialData ?? undefined });
