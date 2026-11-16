import type { MessageKey } from '@nibleaf/i18n';
import { useT } from '@nibleaf/i18n/react';
import type { IntegrationCatalogEntry, IntegrationConnectionSummary, IntegrationProviderId } from '@nibleaf/shared/integrations';
import type { IntegrationRevisionBody, VerifyProjectIntegrationBody } from '@nibleaf/validators';
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
const INTEGRATION_ERROR_KEYS = new Map<string, MessageKey>([
  ['integration:revision_conflict', 'error.conflict'],
  ['integration:idempotency_conflict', 'error.conflict'],
  ['integration:rate_limited', 'error.rateLimited'],
  ['integration:credentials_invalid', 'settings.integrations.errorCredentialsInvalid'],
  ['integration:verification_failed', 'settings.integrations.errorVerificationFailed'],
  ['integration:provider_unavailable', 'settings.integrations.errorProviderUnavailable'],
]);

export const integrationErrorMessage = (t: Translate, error: unknown): string => {
  const key = error instanceof ApiResponseError && error.code ? INTEGRATION_ERROR_KEYS.get(error.code) : undefined;
  return key ? t(key) : friendlyErrorMessage(t, error, 'settings.integrations.actionError');
};

/**
 * A failed integration request as it may be kept and logged: only the HTTP
 * status, a code `integrationErrorMessage` words, and a numeric Retry-After.
 * The server's message, details and any other code are dropped, since they
 * could echo a credential the request sent.
 */
export const safeIntegrationError = (error: unknown): Error => {
  if (error instanceof ApiResponseError) {
    const status = Number.isInteger(error.status) && error.status >= 400 && error.status <= 599 ? error.status : 500;
    const code = error.code && INTEGRATION_ERROR_KEYS.has(error.code) ? error.code : undefined;
    const retryAfter = error.retryAfter && /^\d{1,6}$/.test(error.retryAfter) ? error.retryAfter : undefined;
    return new ApiResponseError(REQUEST_FAILED, status, code, retryAfter);
  }
  return error instanceof TypeError ? new TypeError(REQUEST_FAILED) : new Error(REQUEST_FAILED);
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
