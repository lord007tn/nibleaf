import { useUpdateProjectConfig } from '@/hooks/api';
import { type VariablesValues, variablesPatch, variablesValues } from '../model/variables';

/**
 * Saves the site's variables. Class: form save (operations/ui-overhaul.md
 * §8.2), not optimistic. The mutation invalidates the project (detail and
 * list) and resolves only after that refetch.
 *
 * Rejects on failure, so the form keeps its draft. The mutation sets no
 * `meta.errorMessage`, so the caller owns the error and the global cache
 * stays quiet. Resolves the values the server stored, read back from its
 * response.
 */
export function useSaveVariables(projectId: string) {
  const update = useUpdateProjectConfig(projectId);
  return async (values: VariablesValues) => {
    const project = await update.mutateAsync({ config: { variables: variablesPatch(values) } });
    return variablesValues(project.config);
  };
}
