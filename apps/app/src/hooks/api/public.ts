import { useQuery } from '@tanstack/react-query';
import { getPublicMetaQueryOptions } from './query-options';

export const useGetPublicMeta = (options?: { enabled?: boolean }) => useQuery({ ...getPublicMetaQueryOptions(), enabled: options?.enabled ?? true });
