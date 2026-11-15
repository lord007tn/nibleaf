import { useQueryClient } from '@tanstack/react-query';
import { useExportProjectTheme, useImportProjectTheme, useUpdateProjectConfig } from '@/hooks/api';
import { queryKeys } from '@/hooks/api/query-keys';
import { type ThemeValues, themeConfigPatch, themeValues } from '../model/theme';

/**
 * Saves the theme draft. Class: form save (operations/ui-overhaul.md §8.2),
 * not optimistic. Sends only what changed from `baseline` (see
 * `themeConfigPatch`) and resolves what the server stored, read from the
 * project its own PATCH returns, after the project refetch it starts. Rejects
 * on failure so the form keeps its draft; the caller owns the error.
 */
export function useSaveTheme(projectId: string) {
  const updateProject = useUpdateProjectConfig(projectId);
  return async (values: ThemeValues, baseline: ThemeValues) => {
    const project = await updateProject.mutateAsync({ config: themeConfigPatch(values, baseline) });
    return themeValues(project.config);
  };
}

/**
 * The template exchange, on the existing endpoints:
 * - `preview` validates a template against the stored config and writes nothing;
 * - `apply` writes it at once (a server write, not part of the draft) and
 *   resolves after the project has been read again, so the form's source
 *   already holds what was applied. The import can change typography, branding
 *   and Styling's sections too; the project query, not this result, brings
 *   those to their own forms;
 * - `exportTemplate` downloads what the server stores, never the draft.
 */
export function useThemeExchange(projectId: string) {
  const importTheme = useImportProjectTheme(projectId);
  const exportTheme = useExportProjectTheme(projectId);
  const queryClient = useQueryClient();

  const preview = (template: unknown, mode: 'merge' | 'replace') => importTheme.mutateAsync({ template, mode, apply: false });
  const apply = async (template: unknown, mode: 'merge' | 'replace') => {
    const result = await importTheme.mutateAsync({ template, mode, apply: true });
    // The mutation already started this read; join it rather than start another.
    await queryClient.refetchQueries({ queryKey: queryKeys.projects.detail(projectId), type: 'active' }, { cancelRefetch: false });
    return result;
  };
  const exportTemplate = () => exportTheme.mutateAsync();

  return { preview, apply, exportTemplate };
}
