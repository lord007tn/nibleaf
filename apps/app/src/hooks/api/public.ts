import { useQuery } from '@tanstack/react-query';
import { api } from '@/services/api';
import { getData } from './client-helpers';
import type { PublicMeta } from './types';

export const useGetPublicMeta = (options?: { enabled?: boolean }) =>
  useQuery({
    queryKey: ['public', 'meta'],
    enabled: options?.enabled ?? true,
    queryFn: async () => getData<PublicMeta>(await api.public.meta.$get(), 'public instance metadata'),
    staleTime: 5 * 60 * 1000,
  });

export interface InvitationInfo {
  id: string;
  email: string;
  role: string | null;
  status: string;
  organizationName: string | null;
  expired: boolean;
}

export const useGetInvitationInfo = (invitationId: string) =>
  useQuery({
    queryKey: ['public', 'invitations', invitationId],
    queryFn: async () => getData<InvitationInfo | null>(await api.public.invitations[':id'].$get({ param: { id: invitationId } }), 'invitation'),
  });
