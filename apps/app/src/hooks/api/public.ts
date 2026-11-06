import { useQuery } from '@tanstack/react-query';
import { getInvitationInfoQueryOptions, getPublicMetaQueryOptions } from './query-options';

export const useGetPublicMeta = (options?: { enabled?: boolean }) => useQuery({ ...getPublicMetaQueryOptions(), enabled: options?.enabled ?? true });

export const useGetInvitationInfo = (invitationId: string) => useQuery(getInvitationInfoQueryOptions(invitationId));
