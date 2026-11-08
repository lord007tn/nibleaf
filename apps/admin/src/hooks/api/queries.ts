import { useQuery } from '@tanstack/react-query';
import { api, type InferResponseType } from '@/services/api';

export type AdminUser = InferResponseType<typeof api.admin.users.$get>['data']['items'][number];
export type AdminSite = InferResponseType<typeof api.admin.sites.$get>['data']['items'][number];
export type AdminPublishRetention = InferResponseType<typeof api.admin.funnel.$get>['data']['publishRetention'];

/** Typed failure used by the admin role gate without parsing error messages. */
export class AdminApiError extends Error {
  readonly status: number;

  constructor(status: number) {
    super(`Admin request failed (${status})`);
    this.name = 'AdminApiError';
    this.status = status;
  }
}

export function useAdminOverview() {
  return useQuery({
    queryKey: ['admin', 'overview'],
    queryFn: async () => {
      const res = await api.admin.overview.$get();
      if (!res.ok) {
        throw new AdminApiError(res.status);
      }
      return (await res.json()).data;
    },
  });
}

export function useAdminUsers(options: { search?: string; filter?: 'all' | 'active' | 'unverified' | 'suspended' | 'admin'; cursor?: string } = {}) {
  return useQuery({
    queryKey: ['admin', 'users', options],
    queryFn: async () => {
      const res = await api.admin.users.$get({ query: { search: options.search, cursor: options.cursor, filter: options.filter } });
      if (!res.ok) {
        throw new AdminApiError(res.status);
      }
      return (await res.json()).data;
    },
  });
}

export function useAdminUser(id: string) {
  return useQuery({
    queryKey: ['admin', 'users', id],
    queryFn: async () => {
      const res = await api.admin.users[':id'].$get({ param: { id } });
      if (!res.ok) {
        throw new AdminApiError(res.status);
      }
      return (await res.json()).data;
    },
  });
}

export function useAdminSites(
  options: { search?: string; filter?: 'all' | 'healthy' | 'attention' | 'unpublished' | 'taken-down'; cursor?: string } = {},
) {
  return useQuery({
    queryKey: ['admin', 'sites', options],
    queryFn: async () => {
      const res = await api.admin.sites.$get({ query: { search: options.search, cursor: options.cursor, filter: options.filter } });
      if (!res.ok) {
        throw new AdminApiError(res.status);
      }
      return (await res.json()).data;
    },
  });
}

export function useAdminSite(id: string) {
  return useQuery({
    queryKey: ['admin', 'sites', id],
    queryFn: async () => {
      const res = await api.admin.sites[':id'].$get({ param: { id } });
      if (!res.ok) {
        throw new AdminApiError(res.status);
      }
      return (await res.json()).data;
    },
  });
}

export function useAdminOperations(
  options: { search?: string; cursor?: string; onlyIssues?: boolean; queue?: 'deployments' | 'domains' | 'exports' | 'git' } = {},
) {
  return useQuery({
    queryKey: ['admin', 'operations', options],
    queryFn: async () => {
      const res = await api.admin.operations.$get({
        query: { search: options.search, cursor: options.cursor, onlyIssues: options.onlyIssues ? 'true' : 'false', queue: options.queue },
      });
      if (!res.ok) {
        throw new AdminApiError(res.status);
      }
      return (await res.json()).data;
    },
    refetchInterval: 30_000,
  });
}

export function useAdminFunnel() {
  return useQuery({
    queryKey: ['admin', 'funnel'],
    queryFn: async () => {
      const res = await api.admin.funnel.$get();
      if (!res.ok) {
        throw new AdminApiError(res.status);
      }
      return (await res.json()).data;
    },
  });
}
