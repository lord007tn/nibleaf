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
 * - `apply` writes it at once (a server write, not part of the draft), then
 *   reads the project again. It resolves the server's answer and `refreshed`:
 *   whether that read succeeded after the write, so the form's source holds
 *   what was applied. A failed read never rejects: the write stands. The
 *   import can change typography, branding and Styling's sections too; the
 *   project query, not this result, brings those to their own forms;
 * - `refresh` reads the project again (after a failed read);
 * - `exportTemplate` downloads what the server stores, never the draft.
 */
export function useThemeExchange(projectId: string) {
  const importTheme = useImportProjectTheme(projectId);
  const exportTheme = useExportProjectTheme(projectId);
  const queryClient = useQueryClient();

  const preview = (template: unknown, mode: 'merge' | 'replace') => importTheme.mutateAsync({ template, mode, apply: false });
  const queryKey = queryKeys.projects.detail(projectId);
  const apply = async (template: unknown, mode: 'merge' | 'replace') => {
    const askedAt = Date.now();
    const result = await importTheme.mutateAsync({ template, mode, apply: true });
    // The mutation's invalidation cancelled any older read and started this one; join it.
    await queryClient.refetchQueries({ queryKey, type: 'active' }, { cancelRefetch: false });
    // Read back only if the last read succeeded, and answered after the write was asked for.
    const read = queryClient.getQueryState(queryKey);
    return { result, refreshed: read?.status === 'success' && read.dataUpdatedAt >= askedAt };
  };
  const refresh = () => queryClient.refetchQueries({ queryKey, type: 'active' });
  const exportTemplate = () => exportTheme.mutateAsync();

  return { preview, apply, refresh, exportTemplate };
}
