import { useUpdateProjectConfig } from '@/hooks/api';
import { type RedirectsValues, redirectsPatch, redirectsValues } from '../model/redirects';

/**
 * Saves the site's redirects. Class: form save (operations/ui-overhaul.md
 * §8.2), not optimistic. The mutation invalidates the project (detail and
 * list) and resolves only after that refetch.
 *
 * Rejects on failure, so the form keeps its draft. The mutation sets no
 * `meta.errorMessage`, so the caller owns the error and the global cache
 * stays quiet. Resolves the rules the server stored, read back from its
 * response.
 */
export function useSaveRedirects(projectId: string) {
  const update = useUpdateProjectConfig(projectId);
  return async (values: RedirectsValues) => {
    const project = await update.mutateAsync({ config: { redirects: redirectsPatch(values) } });
    return redirectsValues(project.config);
  };
}
