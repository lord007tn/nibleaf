import type { MessageKey } from '@nibleaf/i18n';
import { useT } from '@nibleaf/i18n/react';
import type { IntegrationCatalogEntry, IntegrationConnectionSummary, IntegrationProviderId } from '@nibleaf/shared/integrations';
import type {
  CreateProjectIntegrationBody,
  IntegrationRevisionBody,
  UpdateProjectIntegrationBody,
  VerifyProjectIntegrationBody,
} from '@nibleaf/validators';
import { useQuery } from '@tanstack/react-query';
import { useSessionMutation as useMutation, useSessionQueryClient as useQueryClient } from '@/integrations/tanstack-query/session-cache';
import { api } from '@/services/api';
import { ApiResponseError, mutateData } from './client-helpers';
import { friendlyErrorMessage } from './errors';
import { queryKeys } from './query-keys';
import { integrationsQueryOptions } from './query-options';

type ConfigurableProviderId = 'slack' | 'discord' | 'zapier';
type Translate = ReturnType<typeof useT>;

// Only for logs: people see `integrationErrorMessage`, never server text.
const REQUEST_FAILED = 'Integration request failed.';

/** What a person can do about an integration failure, keyed by the server's
 *  error code; anything else falls back to the status-based wording. */
const INTEGRATION_ERROR_KEYS: Partial<Record<string, MessageKey>> = {
  'integration:revision_conflict': 'error.conflict',
  'integration:idempotency_conflict': 'error.conflict',
  'integration:rate_limited': 'error.rateLimited',
  'integration:credentials_invalid': 'settings.integrations.errorCredentialsInvalid',
  'integration:verification_failed': 'settings.integrations.errorVerificationFailed',
  'integration:provider_unavailable': 'settings.integrations.errorProviderUnavailable',
};

export const integrationErrorMessage = (t: Translate, error: unknown): string => {
  const key = error instanceof ApiResponseError && error.code ? INTEGRATION_ERROR_KEYS[error.code] : undefined;
  return key ? t(key) : friendlyErrorMessage(t, error, 'settings.integrations.actionError');
};

/** The catalog with each provider's connection. The tab shows its own error
 *  state, so a failed load is not toasted. */
export const useProjectIntegrations = (projectId: string | undefined) => useQuery(integrationsQueryOptions(projectId));

const useIntegrationMutation = <TVariables, TResult>(projectId: string, mutationFn: (variables: TVariables) => Promise<TResult>) => {
  const queryClient = useQueryClient();
  const t = useT();
  return useMutation({
    mutationFn,
    // Toasted by the shared mutation cache, once for every failed call.
    meta: { errorMessage: (error) => integrationErrorMessage(t, error) },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.integrations.all(projectId) }),
    onError: async (error) => {
      // Someone else changed the connection: show its current revision.
      if (error instanceof ApiResponseError && error.code === 'integration:revision_conflict') {
        await queryClient.invalidateQueries({ queryKey: queryKeys.integrations.all(projectId), exact: true, refetchType: 'all' });
      }
    },
  });
};

export const useCreateProjectIntegration = (projectId: string) =>
  useIntegrationMutation(projectId, async (json: CreateProjectIntegrationBody) =>
    mutateData<IntegrationConnectionSummary>(await api.app.projects[':projectId'].integrations.$post({ param: { projectId }, json }), REQUEST_FAILED),
  );

export const useUpdateProjectIntegration = (projectId: string) =>
  useIntegrationMutation(projectId, async ({ providerId, body }: { providerId: ConfigurableProviderId; body: UpdateProjectIntegrationBody }) =>
    mutateData<IntegrationConnectionSummary>(
      await api.app.projects[':projectId'].integrations[':providerId'].$patch({ param: { projectId, providerId }, json: body }),
      REQUEST_FAILED,
    ),
  );

const useStatusProjectIntegration = (projectId: string, action: 'activate' | 'deactivate') =>
  useIntegrationMutation(projectId, async ({ providerId, body }: { providerId: ConfigurableProviderId; body: IntegrationRevisionBody }) => {
    const route = api.app.projects[':projectId'].integrations[':providerId'][action];
    return mutateData<IntegrationConnectionSummary>(await route.$post({ param: { projectId, providerId }, json: body }), REQUEST_FAILED);
  });

export const useActivateProjectIntegration = (projectId: string) => useStatusProjectIntegration(projectId, 'activate');
export const useDeactivateProjectIntegration = (projectId: string) => useStatusProjectIntegration(projectId, 'deactivate');

export const useVerifyProjectIntegration = (projectId: string) =>
  useIntegrationMutation(projectId, async ({ providerId, body }: { providerId: IntegrationProviderId; body: VerifyProjectIntegrationBody }) =>
    mutateData<IntegrationCatalogEntry | IntegrationConnectionSummary>(
      await api.app.projects[':projectId'].integrations[':providerId'].verify.$post({ param: { projectId, providerId }, json: body }),
      REQUEST_FAILED,
    ),
  );

export const useDeleteProjectIntegration = (projectId: string) =>
  useIntegrationMutation(projectId, async ({ providerId, expectedRevision }: { providerId: ConfigurableProviderId; expectedRevision: number }) => {
    const confirmation = await mutateData<{ confirmationToken: string }>(
      await api.app.projects[':projectId'].integrations[':providerId']['delete-confirmation'].$post({
        param: { projectId, providerId },
        json: { expectedRevision },
      }),
      REQUEST_FAILED,
    );
    return mutateData<{ providerId: ConfigurableProviderId; deleted: true }>(
      await api.app.projects[':projectId'].integrations[':providerId'].$delete({
        param: { projectId, providerId },
        json: { confirmationToken: confirmation.confirmationToken },
      }),
      REQUEST_FAILED,
    );
  });
