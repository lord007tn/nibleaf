import { useQuery } from '@tanstack/react-query';
import { api, type InferResponseType } from '@/services/api';

export type AdminOverview = InferResponseType<typeof api.admin.overview.$get>['data'];
export type AdminUser = InferResponseType<typeof api.admin.users.$get>['data'][number];
export type AdminUserDetail = InferResponseType<(typeof api.admin.users)[':id']['$get']>['data'];
export type AdminSite = InferResponseType<typeof api.admin.sites.$get>['data'][number];
export type AdminSiteDetail = InferResponseType<(typeof api.admin.sites)[':id']['$get']>['data'];
export type AdminFunnel = InferResponseType<typeof api.admin.funnel.$get>['data'];
export type AdminOperations = InferResponseType<typeof api.admin.operations.$get>['data'];

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

export function useAdminUsers() {
  return useQuery({
    queryKey: ['admin', 'users'],
    queryFn: async () => {
      const res = await api.admin.users.$get();
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

export function useAdminSites() {
  return useQuery({
    queryKey: ['admin', 'sites'],
    queryFn: async () => {
      const res = await api.admin.sites.$get();
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

export function useAdminOperations() {
  return useQuery({
    queryKey: ['admin', 'operations'],
    queryFn: async () => {
      const res = await api.admin.operations.$get();
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
