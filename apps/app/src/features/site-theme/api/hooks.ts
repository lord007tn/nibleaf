import { type QueryFunction, type QueryKey, useQueryClient } from '@tanstack/react-query';
import { type Project, useExportProjectTheme, useImportProjectTheme, useUpdateProjectConfig } from '@/hooks/api';
import { projectQueryOptions } from '@/hooks/api/query-options';
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
 *   reads the project again. It resolves the server's answer and `readback`:
 *   the project that read returned, or `undefined` when it failed or was
 *   cancelled. A failed read never rejects: the write stands. The import can
 *   change typography, branding and Styling's sections too; the project query,
 *   not this result, brings those to their own forms;
 * - `refresh` reads the project again and resolves it (rejects if that read fails);
 * - `exportTemplate` downloads what the server stores, never the draft.
 */
export function useThemeExchange(projectId: string) {
  const importTheme = useImportProjectTheme(projectId);
  const exportTheme = useExportProjectTheme(projectId);
  const queryClient = useQueryClient();

  const preview = (template: unknown, mode: 'merge' | 'replace') => importTheme.mutateAsync({ template, mode, apply: false });
  /**
   * The project, from a read this call starts and can tell apart. Any read in
   * flight is cancelled first (one started before the write could answer with
   * what was there before it), then this read goes out with a query function
   * that records its own answer. It resolves that answer, and rejects when the
   * read fails or is cancelled: TanStack resolves a cancelled read with the
   * previous data, which is never taken for this one's.
   */
  const readProject = async () => {
    const options = projectQueryOptions(projectId);
    const read = options.queryFn as QueryFunction<Project, QueryKey>;
    let answered: Project | undefined;
    await queryClient.cancelQueries({ queryKey: options.queryKey, exact: true });
    await queryClient.fetchQuery({
      ...options,
      staleTime: 0,
      queryFn: async (context) => {
        answered = await read(context);
        return answered;
      },
    });
    if (!answered) throw new Error('The project read was cancelled.');
    return answered;
  };
  const apply = async (template: unknown, mode: 'merge' | 'replace') => {
    const result = await importTheme.mutateAsync({ template, mode, apply: true });
    const readback = await readProject().catch(() => undefined);
    return { result, readback };
  };
  const refresh = readProject;
  const exportTemplate = () => exportTheme.mutateAsync();

  return { preview, apply, refresh, exportTemplate };
}
