import { useQuery } from '@tanstack/react-query';
import { api, type InferResponseType } from '@/lib/api';

export type AdminOverview = InferResponseType<typeof api.admin.overview.$get>['data'];
export type AdminUser = InferResponseType<typeof api.admin.users.$get>['data'][number];
export type AdminSite = InferResponseType<typeof api.admin.sites.$get>['data'][number];
export type AdminWaitlistEntry = InferResponseType<typeof api.admin.waitlist.$get>['data'][number];

export function useAdminOverview() {
  return useQuery({
    queryKey: ['admin', 'overview'],
    queryFn: async () => {
      const res = await api.admin.overview.$get();
      if (!res.ok) {
        throw new Error(String(res.status));
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
        throw new Error(String(res.status));
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
        throw new Error(String(res.status));
      }
      return (await res.json()).data;
    },
  });
}

export function useAdminWaitlist() {
  return useQuery({
    queryKey: ['admin', 'waitlist'],
    queryFn: async () => {
      const res = await api.admin.waitlist.$get();
      if (!res.ok) {
        throw new Error(String(res.status));
      }
      return (await res.json()).data;
    },
  });
}
