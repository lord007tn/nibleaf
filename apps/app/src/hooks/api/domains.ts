import { useT } from '@nibleaf/i18n/react';
import type { AddDomainBody } from '@nibleaf/validators';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/services/api';
import { mutateData } from './client-helpers';
import { domainErrorMessage } from './domain-state';
import { queryKeys } from './query-keys';
import type { Domain } from './types';

/** The form shows its own error under the field, so this reports nothing itself. */
export const useAddDomain = (projectId: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: AddDomainBody) =>
      mutateData<Domain>(await api.app.projects[':projectId'].domains.$post({ param: { projectId }, json: body }), 'Could not add the domain.'),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.domains.all(projectId) }),
  });
};

export const useVerifyDomain = (projectId: string) => {
  const qc = useQueryClient();
  const t = useT();
  return useMutation({
    mutationFn: async (id: string) =>
      mutateData<Domain>(await api.app.projects[':projectId'].domains[':id'].verify.$post({ param: { projectId, id } }), 'Could not verify.'),
    // Failed checks persist their actionable status before returning an error,
    // so refresh the row on both success and failure.
    onSettled: () => qc.invalidateQueries({ queryKey: queryKeys.domains.all(projectId) }),
    meta: { errorMessage: (error) => domainErrorMessage(t, error, 'settings.domain.toast.verifyError') },
  });
};

export const useSetPrimaryDomain = (projectId: string) => {
  const qc = useQueryClient();
  const t = useT();
  return useMutation({
    mutationFn: async (id: string) =>
      mutateData(
        await api.app.projects[':projectId'].domains[':id'].primary.$post({ param: { projectId, id } }),
        'Could not set the primary domain.',
      ),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.domains.all(projectId) }),
    meta: { errorMessage: (error) => domainErrorMessage(t, error, 'settings.domain.toast.primaryError') },
  });
};

export const useDeleteDomain = (projectId: string) => {
  const qc = useQueryClient();
  const t = useT();
  return useMutation({
    mutationFn: async (id: string) =>
      mutateData(await api.app.projects[':projectId'].domains[':id'].$delete({ param: { projectId, id } }), 'Could not remove the domain.'),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.domains.all(projectId) }),
    meta: { errorMessage: (error) => domainErrorMessage(t, error, 'settings.domain.toast.removeError') },
  });
};
