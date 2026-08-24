import { useT } from '@nibleaf/i18n/react';
import type { IntegrationCatalogEntry, IntegrationConnectionSummary, IntegrationProviderId } from '@nibleaf/shared/integrations';
import type {
  CreateProjectIntegrationBody,
  IntegrationRevisionBody,
  UpdateProjectIntegrationBody,
  VerifyProjectIntegrationBody,
} from '@nibleaf/validators';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/services/api';
import { ApiResponseError, getData, mutateData } from './client-helpers';
import { queryKeys } from './query-keys';

type ConfigurableProviderId = 'slack' | 'discord' | 'zapier';

export const useProjectIntegrations = (projectId: string) => {
  const t = useT();
  return useQuery({
    enabled: Boolean(projectId),
    queryKey: queryKeys.integrations.all(projectId),
    queryFn: async () =>
      getData<IntegrationCatalogEntry[]>(
        await api.app.projects[':projectId'].integrations.$get({ param: { projectId } }),
        'integrations',
        t('settings.integrations.actionError'),
      ),
  });
};

const useIntegrationMutation = <TVariables, TResult>(projectId: string, mutationFn: (variables: TVariables) => Promise<TResult>) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.integrations.all(projectId) }),
    onError: async (error) => {
      if (error instanceof ApiResponseError && error.code === 'integration:revision_conflict') {
        await queryClient.invalidateQueries({ queryKey: queryKeys.integrations.all(projectId), exact: true, refetchType: 'all' });
      }
    },
  });
};

export const useCreateProjectIntegration = (projectId: string) => {
  const t = useT();
  return useIntegrationMutation(projectId, async (json: CreateProjectIntegrationBody) =>
    mutateData<IntegrationConnectionSummary>(
      await api.app.projects[':projectId'].integrations.$post({ param: { projectId }, json }),
      t('settings.integrations.actionError'),
    ),
  );
};

export const useUpdateProjectIntegration = (projectId: string) => {
  const t = useT();
  return useIntegrationMutation(projectId, async ({ providerId, body }: { providerId: ConfigurableProviderId; body: UpdateProjectIntegrationBody }) =>
    mutateData<IntegrationConnectionSummary>(
      await api.app.projects[':projectId'].integrations[':providerId'].$patch({ param: { projectId, providerId }, json: body }),
      t('settings.integrations.actionError'),
    ),
  );
};

const useStatusProjectIntegration = (projectId: string, action: 'activate' | 'deactivate') => {
  const t = useT();
  return useIntegrationMutation(projectId, async ({ providerId, body }: { providerId: ConfigurableProviderId; body: IntegrationRevisionBody }) => {
    const route = api.app.projects[':projectId'].integrations[':providerId'][action];
    return mutateData<IntegrationConnectionSummary>(
      await route.$post({ param: { projectId, providerId }, json: body }),
      t('settings.integrations.actionError'),
    );
  });
};

export const useActivateProjectIntegration = (projectId: string) => useStatusProjectIntegration(projectId, 'activate');
export const useDeactivateProjectIntegration = (projectId: string) => useStatusProjectIntegration(projectId, 'deactivate');

export const useVerifyProjectIntegration = (projectId: string) => {
  const t = useT();
  return useIntegrationMutation(projectId, async ({ providerId, body }: { providerId: IntegrationProviderId; body: VerifyProjectIntegrationBody }) =>
    mutateData<IntegrationCatalogEntry | IntegrationConnectionSummary>(
      await api.app.projects[':projectId'].integrations[':providerId'].verify.$post({ param: { projectId, providerId }, json: body }),
      t('settings.integrations.actionError'),
    ),
  );
};

export const useDeleteProjectIntegration = (projectId: string) => {
  const t = useT();
  return useIntegrationMutation(
    projectId,
    async ({ providerId, expectedRevision }: { providerId: ConfigurableProviderId; expectedRevision: number }) => {
      const confirmation = await mutateData<{ confirmationToken: string }>(
        await api.app.projects[':projectId'].integrations[':providerId']['delete-confirmation'].$post({
          param: { projectId, providerId },
          json: { expectedRevision },
        }),
        t('settings.integrations.actionError'),
      );
      return mutateData<{ providerId: ConfigurableProviderId; deleted: true }>(
        await api.app.projects[':projectId'].integrations[':providerId'].$delete({
          param: { projectId, providerId },
          json: { confirmationToken: confirmation.confirmationToken },
        }),
        t('settings.integrations.actionError'),
      );
    },
  );
};
