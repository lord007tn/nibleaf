import { useQuery } from '@tanstack/react-query';
import { api } from '@/services/api';
import { getData } from './client-helpers';

export const useProjectAvailability = (organizationId: string, name: string, slug: string | undefined, enabled: boolean) =>
  useQuery({
    queryKey: ['projects', 'availability', organizationId, name, slug],
    queryFn: async () =>
      getData(
        await api.app.projects.availability.$get({ query: { organizationId, name, ...(slug === undefined ? {} : { slug }) } }),
        'site availability',
      ),
    enabled,
    retry: false,
    staleTime: 0,
  });
