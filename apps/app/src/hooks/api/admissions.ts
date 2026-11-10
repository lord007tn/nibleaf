import { api } from '@/services/api';
import { mutateData } from './client-helpers';
export const acceptInvitation = async (id: string) =>
  mutateData(await api.app.invitations[':id'].accept.$post({ param: { id } }), 'Could not accept the invitation.');
