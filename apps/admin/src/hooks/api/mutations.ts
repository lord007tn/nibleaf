import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { APP_URL } from '@/lib/links';
import { api } from '@/services/api';
import { authClient } from '@/services/auth-client';

/** Pull the server's message out of the `{ error: { message } }` envelope so
 *  validation failures surface instead of a generic toast. Empty when the body
 *  isn't that shape, letting callers fall back to a friendly default. */
async function serverErrorMessage(res: { json: () => Promise<unknown> }): Promise<string> {
  try {
    const body = (await res.json()) as { error?: { message?: string } };
    return body?.error?.message?.trim() ?? '';
  } catch {
    return '';
  }
}

export function useStartSupportAccess() {
  return useMutation({
    mutationFn: async ({ userId, organizationId }: { userId: string; organizationId: string }) => {
      const impersonation = await authClient.admin.impersonateUser({ userId });
      if (impersonation.error) throw new Error(impersonation.error.message || 'Could not authorize support access.');
      const workspace = await authClient.organization.setActive({ organizationId });
      if (workspace.error) {
        await authClient.admin.stopImpersonating();
        throw new Error(workspace.error.message || 'Could not select the customer workspace.');
      }
      return impersonation.data;
    },
    onSuccess: () => {
      window.location.assign(`${APP_URL}/app`);
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : 'Could not start support access.'),
  });
}

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
    onSuccess: (_data, { id }) => {
      qc.invalidateQueries({ queryKey: ['admin', 'users'] });
      qc.invalidateQueries({ queryKey: ['admin', 'users', id] });
      qc.invalidateQueries({ queryKey: ['admin', 'overview'] });
      toast.success('Role updated');
    },
    onError: () => toast.error('Could not update role'),
  });
}

export function useSuspendUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, suspend }: { id: string; suspend: boolean }) => {
      const res = suspend
        ? await api.admin.users[':id'].suspend.$post({ param: { id } })
        : await api.admin.users[':id'].unsuspend.$post({ param: { id } });
      if (!res.ok) {
        throw new Error(String(res.status));
      }
      return (await res.json()).data;
    },
    onSuccess: (_data, { id, suspend }) => {
      qc.invalidateQueries({ queryKey: ['admin', 'users'] });
      qc.invalidateQueries({ queryKey: ['admin', 'users', id] });
      qc.invalidateQueries({ queryKey: ['admin', 'sites'] });
      toast.success(suspend ? 'Account suspended' : 'Suspension lifted');
    },
    onError: (_err, { suspend }) => toast.error(suspend ? 'Could not suspend the account' : 'Could not lift the suspension'),
  });
}

export function useTakedownSite() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { id: string; takedown: true; reason: string } | { id: string; takedown: false }) => {
      const res = input.takedown
        ? await api.admin.sites[':id'].takedown.$post({ param: { id: input.id }, json: { reason: input.reason } })
        : await api.admin.sites[':id'].restore.$post({ param: { id: input.id } });
      if (!res.ok) {
        throw new Error((await serverErrorMessage(res)) || String(res.status));
      }
      return (await res.json()).data;
    },
    onSuccess: (_data, { id, takedown }) => {
      qc.invalidateQueries({ queryKey: ['admin', 'sites'] });
      qc.invalidateQueries({ queryKey: ['admin', 'sites', id] });
      qc.invalidateQueries({ queryKey: ['admin', 'operations'] });
      qc.invalidateQueries({ queryKey: ['admin', 'overview'] });
      toast.success(takedown ? 'Site taken down' : 'Site restored');
    },
    onError: (err, { takedown }) => {
      // Prefer the server's message (e.g. a rejected reason) so failures are
      // diagnosable; a bare status number falls back to the friendly default.
      const message = err instanceof Error ? err.message : '';
      const fallback = takedown ? 'Could not take the site down' : 'Could not restore the site';
      toast.error(message && !/^\d+$/.test(message) ? message : fallback);
    },
  });
}

export type InviteOrganizationInput = {
  organizationName: string;
  siteName: string;
  ownerEmail: string;
  siteSlug?: string;
  description?: string;
  delivery: 'email' | 'link';
};

export function useInviteOrganization() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: InviteOrganizationInput) => {
      const res = await api.admin.organizations.invite.$post({ json: input });
      if (!res.ok) {
        throw new Error((await serverErrorMessage(res)) || String(res.status));
      }
      return (await res.json()).data;
    },
    onSuccess: (_data, input) => {
      qc.invalidateQueries({ queryKey: ['admin', 'sites'] });
      qc.invalidateQueries({ queryKey: ['admin', 'overview'] });
      toast.success(input.delivery === 'email' ? `Owner invitation queued for ${input.ownerEmail}` : 'Owner invitation link created');
    },
    onError: (error) => toast.error(error instanceof Error && !/^\d+$/.test(error.message) ? error.message : 'Could not invite the organization'),
  });
}
