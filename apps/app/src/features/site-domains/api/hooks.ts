import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useAddDomain, useDomains, useSetPrimaryDomain, useVerifyDomain } from '@/hooks/api';
import { mutateData } from '@/hooks/api/client-helpers';
import { queryKeys } from '@/hooks/api/query-keys';
import { api } from '@/services/api';

/** The site's custom domains, oldest first (shared with the overview and the route loader). */
export const useSiteDomains = (projectId: string) => useDomains(projectId);

/**
 * Adds a domain. Class: server-confirmed (operations/ui-overhaul.md §8.2): the
 * server checks the name against every site and creates the id. No
 * `meta.errorMessage`: the add form owns the error (under the field when it is
 * about the host, a toast otherwise).
 */
export const useAddSiteDomain = (projectId: string) => useAddDomain(projectId);

/**
 * Checks a domain's DNS and HTTPS. Class: server-confirmed: the answer comes
 * from outside (DNS, the certificate provider), and a failed check can demote
 * the main address. Its failure is toasted by the shared mutation
 * (`meta.errorMessage`); the row only reports what a finished check found.
 */
export const useCheckSiteDomain = (projectId: string) => useVerifyDomain(projectId);

/**
 * Makes a domain the main address. Class: server-confirmed: it changes the
 * other rows too (exactly one primary). Failure is toasted by the shared
 * mutation (`meta.errorMessage`).
 */
export const useSetPrimarySiteDomain = (projectId: string) => useSetPrimaryDomain(projectId);

/**
 * Removes a domain. Class: server-confirmed. Run from an `ActionDialog`, which
 * shows the failure inside the dialog, so this sets no `meta.errorMessage` and
 * the global cache stays quiet (one owner per error, §8.2). The shared
 * `useDeleteDomain` toasts globally, so the remove request lives here.
 */
export const useRemoveSiteDomain = (projectId: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) =>
      mutateData(await api.app.projects[':projectId'].domains[':id'].$delete({ param: { projectId, id } }), 'Could not remove the domain.'),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.domains.all(projectId) }),
  });
};
