import { Callout } from '@nibleaf/design-system/components/ui/callout';
import { PageHeader } from '@nibleaf/design-system/components/ui/page-header';
import { SettingsRow } from '@nibleaf/design-system/components/ui/settings-row';
import { SettingsSection } from '@nibleaf/design-system/components/ui/settings-section';
import { StatusBadge } from '@nibleaf/design-system/components/ui/status-badge';
import { Switch } from '@nibleaf/design-system/components/ui/switch';
import { useT } from '@nibleaf/i18n/react';
import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { SettingsFormSkeleton } from '@/components/project-settings/shared';
import { QueryErrorState } from '@/components/query-error-state';
import type { ProjectAddon } from '@/hooks/api';
import { friendlyErrorMessage } from '@/hooks/api/errors';
import { useProjectAdminStatus } from '@/hooks/use-project-admin-status';
import { SaveRegionProvider } from '@/lib/forms/save-region';
import { useAddons, useSetAddonEnabled } from '../api/hooks';
import { ADDON_GROUP_TEXT, ADDON_TEXT, type AdminStatus, addonBadges, addonGroups, readOnlyNote, toggleDecision } from '../model/addons';
import { AddonSettingsForm } from './addon-settings-form';

/** How long the "Saved" hint stays next to a switch after it applied. */
const SAVED_HINT_MS = 3000;

/**
 * Site settings → Add-ons. One section per add-on group; each add-on is a
 * switch that applies at once, followed by its settings (when it has any),
 * which save through the page's save bar.
 */
export function AddonsSettings({ projectId }: { projectId: string }) {
  const t = useT();
  const addons = useAddons(projectId);
  const access = useProjectAdminStatus(projectId);
  if (addons.isPending) return <SettingsFormSkeleton />;
  const note = readOnlyNote(access.status, access.edit);
  return (
    <SaveRegionProvider>
      <div className="me-auto flex w-full max-w-[47.5rem] flex-col gap-8">
        <PageHeader description={t('settings.addons.description')} title={t('settings.addons.title')} />
        {note ? (
          <Callout role="note" title={t('settings.permissions.title')} tone="info">
            {t(note)}
          </Callout>
        ) : null}
        {addons.data ? (
          <>
            {addonGroups(addons.data).map((group) => (
              <SettingsSection description={t(ADDON_GROUP_TEXT[group.id].description)} key={group.id} title={t(ADDON_GROUP_TEXT[group.id].title)}>
                {group.addons.map((addon) => (
                  <AddonEntry addon={addon} key={addon.id} projectId={projectId} status={access.status} />
                ))}
              </SettingsSection>
            ))}
            <p className="text-muted-foreground text-xs">{t('settings.addons.boundary')}</p>
          </>
        ) : (
          <QueryErrorState description={t('settings.addons.loadError')} onRetry={() => void addons.refetch()} retrying={addons.isFetching} />
        )}
      </div>
    </SaveRegionProvider>
  );
}

/**
 * What an add-on's switch and its settings form share. Both write the same
 * add-on and the server checks one revision for both, so they take turns: a
 * settings save waits for a switch flip in flight, the switch is locked while
 * a save runs, and each records the revision the server returned so the next
 * write never sends a stale one (the page's list refetches later).
 */
export type AddonWrites = {
  revision: () => number;
  recordRevision: (revision: number) => void;
  switchSettled: () => Promise<unknown>;
  switching: boolean;
  saving: boolean;
  setSaving: (saving: boolean) => void;
  trackSwitch: (write: Promise<unknown>) => void;
};

function useAddonWrites(addon: ProjectAddon): AddonWrites {
  const known = useRef(addon.revision);
  const pendingSwitch = useRef<Promise<unknown>>(Promise.resolve());
  const [switching, setSwitching] = useState(false);
  const [saving, setSaving] = useState(false);
  return {
    revision: () => Math.max(addon.revision, known.current),
    recordRevision: (revision) => {
      known.current = Math.max(known.current, revision);
    },
    switchSettled: () => pendingSwitch.current,
    switching,
    saving,
    setSaving,
    trackSwitch: (write) => {
      const settled = write.then(
        () => undefined,
        () => undefined,
      );
      pendingSwitch.current = settled;
      setSwitching(true);
      void settled.then(() => setSwitching(false));
    },
  };
}

/** One add-on: its switch row, then its settings in the same panel. */
function AddonEntry({ addon, projectId, status }: { addon: ProjectAddon; projectId: string; status: AdminStatus }) {
  const writes = useAddonWrites(addon);
  return (
    <>
      <AddonToggleRow addon={addon} projectId={projectId} status={status} writes={writes} />
      <AddonSettingsForm addon={addon} projectId={projectId} status={status} writes={writes} />
    </>
  );
}

/**
 * The add-on's on/off switch. It applies on change and waits for the server
 * (the server decides the resulting status), then says "Saved" next to the
 * switch; a refusal leaves the switch as it was and explains in a toast.
 */
function AddonToggleRow({ addon, projectId, status, writes }: { addon: ProjectAddon; projectId: string; status: AdminStatus; writes: AddonWrites }) {
  const t = useT();
  const { setEnabled, isPending } = useSetAddonEnabled(projectId);
  const [saved, setSaved] = useState(false);
  const decision = toggleDecision(addon, status, isPending || writes.switching || writes.saving);
  const text = ADDON_TEXT[addon.id];
  const badges = addonBadges(addon);

  useEffect(() => {
    if (!saved) return;
    const timer = setTimeout(() => setSaved(false), SAVED_HINT_MS);
    return () => clearTimeout(timer);
  }, [saved]);

  const toggle = (enabled: boolean) => {
    setSaved(false);
    const write = setEnabled({ id: addon.id, revision: writes.revision() }, enabled);
    writes.trackSwitch(write);
    write.then(
      (next) => {
        writes.recordRevision(next.revision);
        setSaved(true);
      },
      (error: unknown) => toast.error(friendlyErrorMessage(t, error, 'settings.saveError')),
    );
  };

  return (
    <SettingsRow
      control="switch"
      description={
        <>
          {t(text.description)}
          {badges.length > 0 ? (
            <span className="mt-2 flex flex-wrap gap-1.5">
              {badges.map((badge) => (
                <StatusBadge key={badge.label} tone={badge.tone}>
                  {t(badge.label)}
                </StatusBadge>
              ))}
            </span>
          ) : null}
        </>
      }
      disabledReason={decision.kind === 'denied' ? t(decision.reason) : undefined}
      label={t(text.title)}
    >
      {(ids) => (
        <span className="flex items-center gap-3">
          <span className="text-muted-foreground text-xs" role="status">
            {saved ? t('common.saved') : ''}
          </span>
          <Switch
            {...ids.controlProps}
            aria-labelledby={ids.labelId}
            checked={addon.enabled}
            disabled={decision.kind !== 'allowed'}
            onCheckedChange={toggle}
          />
        </span>
      )}
    </SettingsRow>
  );
}
