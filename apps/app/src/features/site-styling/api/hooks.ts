import { useUpdateProjectConfig } from '@/hooks/api';
import { type StylingConfig, type StylingValues, stylingPatch, stylingValues } from '../model/styling';

/**
 * Saves the styling form. Class: form save (operations/ui-overhaul.md §8.2),
 * not optimistic. Sends `config.styling` with only the keys changed from
 * `baseline` (see `stylingPatch`), and resolves the values the server stored,
 * read from the project its own response returns (never from the query
 * cache). Rejects on failure so the form keeps its draft; the caller owns the
 * error message.
 */
export function useSaveStyling(projectId: string) {
  const updateProject = useUpdateProjectConfig(projectId);
  return async (values: StylingValues, baseline: StylingValues) => {
    const project = await updateProject.mutateAsync({ config: { styling: stylingPatch(values, baseline) } });
    return stylingValues(project.config?.styling as StylingConfig | undefined);
  };
}
