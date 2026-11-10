import { queryOptions, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { authClient } from '@/services/auth-client';

/*
 * Personal account reads that go through better-auth (not the /api/app RPC):
 * signed-in devices and linked sign-in methods for Account settings (§5.4.4).
 */

export interface AccountSession {
  id: string;
  token: string;
  createdAt: string | Date;
  updatedAt: string | Date;
  expiresAt: string | Date;
  ipAddress?: string | null;
  userAgent?: string | null;
}
export interface LinkedAccount {
  id: string;
  providerId: string;
  createdAt: string | Date;
}

const unwrap = <T>(result: { data: T | null; error: { message?: string; status?: number } | null }, what: string): T => {
  if (result.error || result.data === null) throw new Error(result.error?.message ?? `Could not load ${what}.`);
  return result.data;
};

const accountKeys = {
  sessions: () => ['account', 'sessions'] as const,
  linked: () => ['account', 'linked'] as const,
};

export const accountSessionsQueryOptions = () =>
  queryOptions({
    queryKey: accountKeys.sessions(),
    queryFn: async () => unwrap((await authClient.listSessions()) as { data: AccountSession[] | null; error: null }, 'sessions'),
  });
export const linkedAccountsQueryOptions = () =>
  queryOptions({
    queryKey: accountKeys.linked(),
    queryFn: async () => unwrap((await authClient.listAccounts()) as { data: LinkedAccount[] | null; error: null }, 'sign-in methods'),
  });

export const useAccountSessions = () => useQuery(accountSessionsQueryOptions());
export const useLinkedAccounts = () => useQuery(linkedAccountsQueryOptions());

export const useRevokeSession = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (token: string) => unwrap((await authClient.revokeSession({ token })) as { data: unknown; error: null }, 'session'),
    onSettled: () => qc.invalidateQueries({ queryKey: accountKeys.sessions() }),
  });
};
export const useRevokeOtherSessions = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => unwrap((await authClient.revokeOtherSessions()) as { data: unknown; error: null }, 'sessions'),
    onSettled: () => qc.invalidateQueries({ queryKey: accountKeys.sessions() }),
  });
};
/** Refused by the server while you own an organization (§5.4.4); the UI lists them first. */
export const useDeleteAccount = () =>
  useMutation({
    mutationFn: async () => {
      const result = (await authClient.deleteUser({})) as { data: unknown; error: { message?: string; status?: number } | null };
      if (result.error) throw Object.assign(new Error(result.error.message ?? 'Could not delete the account.'), { status: result.error.status });
      return result.data;
    },
  });
