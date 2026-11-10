import type { AddonId } from '@nibleaf/shared/addons';
import { type ProjectAddon, useActivateProjectAddon, useDeactivateProjectAddon, useProjectAddons, useUpdateProjectAddon } from '@/hooks/api';

/** Every add-on of a site, with its state, settings and availability. */
export const useAddons = (projectId: string) => useProjectAddons(projectId);

/**
 * Turns one add-on on or off. Class: server-confirmed (operations/ui-overhaul.md
 * §8.2), not optimistic: the server decides the resulting status (an add-on
 * that still needs settings comes back "needs configuration") and refuses a
 * stale revision. The underlying mutations write the returned add-on to its
 * detail key and invalidate the add-on list and the project.
 *
 * `setEnabled` rejects on failure; the caller words the error. These mutations
 * set no `meta.errorMessage`, so the global cache stays quiet.
 */
export function useSetAddonEnabled(projectId: string) {
  const activate = useActivateProjectAddon(projectId);
  const deactivate = useDeactivateProjectAddon(projectId);
  const setEnabled = (addon: Pick<ProjectAddon, 'id' | 'revision'>, enabled: boolean) =>
    (enabled ? activate : deactivate).mutateAsync({ addonId: addon.id, expectedRevision: addon.revision });
  return { setEnabled, isPending: activate.isPending || deactivate.isPending };
}

/**
 * Saves one add-on's settings. Class: form save (§8.2). It is not optimistic;
 * the mutation writes the returned add-on to its detail key and invalidates
 * the add-on list and the project. A stale revision is refused with
 * `addon:revision_conflict`, after which the mutation refetches the add-on.
 *
 * `save` resolves with the server's add-on (its normalized config) and
 * rejects on failure so the form stays dirty.
 */
export function useSaveAddonSettings(projectId: string) {
  const update = useUpdateProjectAddon(projectId);
  const save = (addonId: AddonId, config: Record<string, unknown>, expectedRevision: number) =>
    update.mutateAsync({ addonId, body: { config, expectedRevision } });
  return { save, isPending: update.isPending };
}
