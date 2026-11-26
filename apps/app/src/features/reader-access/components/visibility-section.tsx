import { ActionDialog } from '@nibleaf/design-system/components/ui/action-dialog';
import { Button, buttonVariants } from '@nibleaf/design-system/components/ui/button';
import { RadioField, RadioGroup } from '@nibleaf/design-system/components/ui/radio-group';
import { SettingsSection, SettingsSectionBody } from '@nibleaf/design-system/components/ui/settings-section';
import { StatusBadge } from '@nibleaf/design-system/components/ui/status-badge';
import { useT } from '@nibleaf/i18n/react';
import { useStore } from '@tanstack/react-form';
import { Link } from '@tanstack/react-router';
import { Globe, Mail, Users } from 'lucide-react';
import { useId, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { DirtyStateReporter } from '@/components/project-settings/shared';
import { friendlyErrorMessage } from '@/hooks/api/errors';
import { useServerDraftForm } from '@/lib/forms/use-server-draft';
import type { SiteAdminState } from '@/lib/project-settings-access';
import { useSetAccessMode } from '../api/hooks';
import { ACCESS_MODES, type AccessMode, decisionProps, isExposingChange, modeDecision, visibilityChangeCopy } from '../model/access';
import { DraftConflicts } from './draft-conflicts';

const ICONS = { globe: Globe, users: Users, mail: Mail } as const;

/**
 * Who can read the published site: Public, Team only, or Invited readers, as
 * the design-system RadioGroup (Tab enters once, arrow keys follow the reading
 * direction, the whole row is the target). Choosing only
 * previews, so arrowing through the choices never changes anything; "Save
 * visibility" asks for a confirmation that says what changes for readers and
 * applies it from that dialog.
 *
 * The choice is a one-field draft (`useServerDraftForm`, identity
 * `[projectId, 'reader-access-mode']`), not a copy of the server value, so a
 * refetch (after inviting someone, say) never resets an unsaved choice. It has
 * its own Save, not the page's save bar: a change of visibility always goes
 * through its confirmation, alone.
 */
export function VisibilitySection({ projectId, current, status }: { projectId: string; current: AccessMode; status: SiteAdminState }) {
  const t = useT();
  const setMode = useSetAccessMode(projectId);
  const failure = useRef<unknown>(null);
  // Saved while React kept the dialog hidden: its draft reports the submit as failed, but the change went through.
  const savedAway = useRef(false);
  const [confirming, setConfirming] = useState(false);
  const reasonId = useId();

  const source = useMemo(() => ({ mode: current }), [current]);
  const { form, ...draft } = useServerDraftForm<{ mode: AccessMode }>({
    identity: [projectId, 'reader-access-mode'],
    source,
    onSubmit: async (value, outcome) => {
      try {
        await setMode.mutateAsync({ mode: value.mode });
        outcome.succeeded(value);
        if (!outcome.isCurrent()) savedAway.current = true;
        return 'saved';
      } catch (error) {
        outcome.failed();
        // The dialog that ran the save shows why it failed.
        failure.current = error;
        return 'failed';
      }
    },
  });
  const chosen = useStore(form.store, (state) => state.values.mode);
  const saved = draft.baseline.mode;
  const { disabled, reason } = decisionProps(modeDecision(status, draft.isSaving));
  const copy = visibilityChangeCopy(saved, chosen);

  return (
    <>
      <DirtyStateReporter dirty={draft.isDirty} />
      <SettingsSection
        footer={
          current === 'WORKSPACE' ? (
            <>
              <p className="flex min-w-0 flex-1 basis-64 items-start gap-2">
                <Users aria-hidden className="mt-0.5 size-4 shrink-0" />
                {t('settings.visibility.teamNote')}
              </p>
              <Link
                className={buttonVariants({ variant: 'outline', size: 'sm', className: 'shrink-0' })}
                params={{ projectId }}
                search={{ section: 'members' }}
                to="/app/projects/$projectId/settings"
              >
                {t('settings.visibility.openMembers')}
              </Link>
            </>
          ) : undefined
        }
        title={t('settings.visibility.title')}
      >
        <DraftConflicts conflicts={draft.conflicts} resolve={draft.resolveConflict} />
        <RadioGroup
          aria-describedby={reason ? reasonId : undefined}
          aria-label={t('settings.visibility.title')}
          className="gap-0 divide-y divide-border"
          disabled={disabled}
          onValueChange={(next) => form.setFieldValue('mode', next as AccessMode)}
          value={chosen}
        >
          {ACCESS_MODES.map((option) => {
            const Icon = ICONS[option.icon];
            return (
              <RadioField
                className="min-w-0 px-4 py-4 transition-colors has-data-checked:bg-primary/5 not-has-data-checked:not-has-data-disabled:hover:bg-muted/40 sm:px-5"
                description={t(option.body)}
                key={option.mode}
                label={
                  <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <Icon aria-hidden className="size-4 text-muted-foreground" />
                    {t(option.title)}
                    {option.mode === saved ? (
                      <StatusBadge size="sm" tone="neutral">
                        {t('settings.visibility.current')}
                      </StatusBadge>
                    ) : null}
                  </span>
                }
                value={option.mode}
              />
            );
          })}
        </RadioGroup>
        {reason ? (
          <p className="px-4 py-3 text-muted-foreground text-sm sm:px-5" id={reasonId}>
            {t(reason)}
          </p>
        ) : null}
        {draft.isDirty ? (
          <SettingsSectionBody className="flex flex-wrap items-center gap-2">
            <Button loading={draft.isSaving} onClick={() => setConfirming(true)} type="button">
              {t('settings.visibility.save')}
            </Button>
            <Button disabled={draft.isSaving} onClick={draft.discard} type="button" variant="ghost">
              {t('common.cancel')}
            </Button>
          </SettingsSectionBody>
        ) : null}
      </SettingsSection>
      <ActionDialog
        cancelLabel={t('common.cancel')}
        confirmLabel={t('settings.visibility.confirmAction')}
        description={t(copy.description)}
        destructive={isExposingChange(chosen)}
        errorMessage={(error) => friendlyErrorMessage(t, error, 'settings.saveError')}
        fallbackErrorMessage={t('settings.saveError')}
        onConfirm={async () => {
          failure.current = null;
          savedAway.current = false;
          const outcome = await draft.submit();
          if (outcome === 'saved') {
            toast.success(t('settings.visibility.saved'));
            return;
          }
          // The dialog closes once shown again, with nothing else said.
          if (savedAway.current) return;
          throw failure.current ?? new Error('The visibility change was not saved.');
        }}
        onOpenChange={setConfirming}
        open={confirming}
        title={t(copy.title)}
      />
    </>
  );
}
