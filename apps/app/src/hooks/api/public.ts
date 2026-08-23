import { useQuery } from '@tanstack/react-query';
import { api } from '@/services/api';
import { getData } from './client-helpers';

export const useGetPublicMeta = (options?: { enabled?: boolean }) =>
  useQuery({
    queryKey: ['public', 'meta'],
    enabled: options?.enabled ?? true,
    queryFn: async () => getData(await api.public.meta.$get(), 'public instance metadata'),
    staleTime: 5 * 60 * 1000,
  });

export const useGetInvitationInfo = (invitationId: string) =>
  useQuery({
    queryKey: ['public', 'invitations', invitationId],
    queryFn: async () => getData(await api.public.invitations[':id'].$get({ param: { id: invitationId } }), 'invitation'),
  });
