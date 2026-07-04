import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api } from '@/lib/api';

export function useSetUserRole() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, role }: { id: string; role: 'user' | 'admin' }) => {
      const res = await api.admin.users[':id'].role.$post({ param: { id }, json: { role } });
      if (!res.ok) {
        throw new Error(String(res.status));
      }
      return (await res.json()).data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin', 'users'] });
      qc.invalidateQueries({ queryKey: ['admin', 'overview'] });
      toast.success('Role updated');
    },
    onError: () => toast.error('Could not update role'),
  });
}

export function useDeleteWaitlistEntry() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const res = await api.admin.waitlist[':id'].$delete({ param: { id } });
      if (!res.ok) {
        throw new Error(String(res.status));
      }
      return (await res.json()).data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin', 'waitlist'] });
      qc.invalidateQueries({ queryKey: ['admin', 'overview'] });
      toast.success('Removed from waitlist');
    },
    onError: () => toast.error('Could not remove'),
  });
}
