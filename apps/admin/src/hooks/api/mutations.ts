import { useT } from '@nibleaf/i18n/react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { APP_URL } from '@/lib/links';
import { api } from '@/services/api';
import { authClient } from '@/services/auth-client';

class AdminMutationError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'AdminMutationError';
  }
}

async function throwServerError(res: { json: () => Promise<unknown>; status: number }, fallbackCode: string): Promise<never> {
  let error: { code?: string; message?: string } | undefined;
  try {
    const body = (await res.json()) as { error?: { code?: string; message?: string } };
    error = body.error;
  } catch {
    // The status and fallback code still preserve a useful machine-readable failure.
  }
  throw new AdminMutationError(error?.message?.trim() || fallbackCode, error?.code || fallbackCode, res.status);
}

export function useStartSupportAccess() {
  const t = useT();
  return useMutation({
    mutationFn: async ({ userId, organizationId }: { userId: string; organizationId: string }) => {
      const impersonation = await authClient.admin.impersonateUser({ userId });
      if (impersonation.error) {
        throw new AdminMutationError(
          impersonation.error.message || t('admin.mutation.supportAuthorizeError'),
          impersonation.error.code || 'auth:impersonation_failed',
          impersonation.error.status,
        );
      }
      const workspace = await authClient.organization.setActive({ organizationId });
      if (workspace.error) {
        await authClient.admin.stopImpersonating();
        throw new AdminMutationError(
          workspace.error.message || t('admin.mutation.workspaceSelectError'),
          workspace.error.code || 'auth:workspace_selection_failed',
          workspace.error.status,
        );
      }
      return impersonation.data;
    },
    onSuccess: () => {
      window.location.assign(`${APP_URL}/app`);
    },
    onError: (error) => toast.error(error instanceof AdminMutationError ? error.message : t('admin.mutation.supportStartError')),
  });
}

export function useSetUserRole() {
  const qc = useQueryClient();
  const t = useT();
  return useMutation({
    mutationFn: async ({ id, role }: { id: string; role: 'user' | 'admin' }) => {
      const res = await api.admin.users[':id'].role.$post({ param: { id }, json: { role } });
      if (!res.ok) {
        await throwServerError(res, 'admin:user_role_update_failed');
      }
      return (await res.json()).data;
    },
    onSuccess: (_data, { id }) => {
      qc.invalidateQueries({ queryKey: ['admin', 'users'] });
      qc.invalidateQueries({ queryKey: ['admin', 'users', id] });
      qc.invalidateQueries({ queryKey: ['admin', 'overview'] });
      toast.success(t('admin.mutation.roleUpdated'));
    },
    onError: () => toast.error(t('admin.mutation.roleUpdateError')),
  });
}

export function useSuspendUser() {
  const qc = useQueryClient();
  const t = useT();
  return useMutation({
    mutationFn: async ({ id, suspend }: { id: string; suspend: boolean }) => {
      const res = suspend
        ? await api.admin.users[':id'].suspend.$post({ param: { id } })
        : await api.admin.users[':id'].unsuspend.$post({ param: { id } });
      if (!res.ok) {
        await throwServerError(res, suspend ? 'admin:user_suspend_failed' : 'admin:user_unsuspend_failed');
      }
      return (await res.json()).data;
    },
    onSuccess: (_data, { id, suspend }) => {
      qc.invalidateQueries({ queryKey: ['admin', 'users'] });
      qc.invalidateQueries({ queryKey: ['admin', 'users', id] });
      qc.invalidateQueries({ queryKey: ['admin', 'sites'] });
      toast.success(suspend ? t('admin.mutation.accountSuspended') : t('admin.mutation.suspensionLifted'));
    },
    onError: (_err, { suspend }) => toast.error(suspend ? t('admin.mutation.accountSuspendError') : t('admin.mutation.suspensionLiftError')),
  });
}

export function useTakedownSite() {
  const qc = useQueryClient();
  const t = useT();
  return useMutation({
    mutationFn: async (input: { id: string; takedown: true; reason: string } | { id: string; takedown: false }) => {
      const res = input.takedown
        ? await api.admin.sites[':id'].takedown.$post({ param: { id: input.id }, json: { reason: input.reason } })
        : await api.admin.sites[':id'].restore.$post({ param: { id: input.id } });
      if (!res.ok) {
        await throwServerError(res, input.takedown ? 'admin:site_takedown_failed' : 'admin:site_restore_failed');
      }
      return (await res.json()).data;
    },
    onSuccess: (_data, { id, takedown }) => {
      qc.invalidateQueries({ queryKey: ['admin', 'sites'] });
      qc.invalidateQueries({ queryKey: ['admin', 'sites', id] });
      qc.invalidateQueries({ queryKey: ['admin', 'operations'] });
      qc.invalidateQueries({ queryKey: ['admin', 'overview'] });
      toast.success(takedown ? t('admin.mutation.siteTakenDown') : t('admin.mutation.siteRestored'));
    },
    onError: (err, { takedown }) => {
      // Prefer the server's message (e.g. a rejected reason) so failures are
      // diagnosable; a bare status number falls back to the friendly default.
      const fallback = takedown ? t('admin.mutation.siteTakedownError') : t('admin.mutation.siteRestoreError');
      toast.error(err instanceof AdminMutationError && err.message !== err.code ? err.message : fallback);
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
  const t = useT();
  return useMutation({
    mutationFn: async (input: InviteOrganizationInput) => {
      const res = await api.admin.organizations.invite.$post({ json: input });
      if (!res.ok) {
        await throwServerError(res, 'admin:organization_invite_failed');
      }
      return (await res.json()).data;
    },
    onSuccess: (_data, input) => {
      qc.invalidateQueries({ queryKey: ['admin', 'sites'] });
      qc.invalidateQueries({ queryKey: ['admin', 'overview'] });
      toast.success(
        input.delivery === 'email' ? t('admin.mutation.invitationQueued', { email: input.ownerEmail }) : t('admin.mutation.invitationLinkCreated'),
      );
    },
    onError: (error) =>
      toast.error(error instanceof AdminMutationError && error.message !== error.code ? error.message : t('admin.mutation.organizationInviteError')),
  });
}
