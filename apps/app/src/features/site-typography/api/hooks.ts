import { useUpdateProjectConfig } from '@/hooks/api';
import { type TypographyValues, typographyUpdate, typographyValues } from '../model/typography';

/**
 * Saves the Typography form as one `config.typography` patch. Class: form save
 * (operations/ui-overhaul.md §8.2). It is not optimistic; the mutation
 * invalidates the project detail and list.
 *
 * `save` resolves with the typography values the server now holds, read from
 * the updated project it returns, and rejects on failure so the form stays
 * dirty. The caller owns the error: the mutation sets no `meta.errorMessage`,
 * so the global cache stays quiet.
 */
export function useSaveTypography(projectId: string) {
  const update = useUpdateProjectConfig(projectId);
  const save = async (baseline: TypographyValues, submitted: TypographyValues) => {
    const project = await update.mutateAsync({ config: { typography: typographyUpdate(baseline, submitted) } });
    return typographyValues(project.config);
  };
  return { save };
}
