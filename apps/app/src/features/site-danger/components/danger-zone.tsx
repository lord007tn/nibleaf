import { ActionDialog } from '@nibleaf/design-system/components/ui/action-dialog';
import { Button } from '@nibleaf/design-system/components/ui/button';
import { PageHeader } from '@nibleaf/design-system/components/ui/page-header';
import { SettingsRow } from '@nibleaf/design-system/components/ui/settings-row';
import { SettingsSection } from '@nibleaf/design-system/components/ui/settings-section';
import { useT } from '@nibleaf/i18n/react';
import { useNavigate } from '@tanstack/react-router';
import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import type { Project, SwitcherOrganization } from '@/hooks/api';
import { friendlyErrorMessage } from '@/hooks/api/errors';
import { isolate } from '@/lib/bidi';
import { useSession } from '@/services/auth-client';
import { useDeleteWebsite } from '../api/delete-website';
import { completionStillApplies } from '../model/delete';

/**
 * Website Danger zone: delete this website. Only the organization's Owner and
 * Admins reach it (the settings route decides `site.delete`). Its pages,
 * domain connections and analytics go for good; the organization and its
 * members stay, and the person lands on the organization's Websites.
 * Ownership is an organization matter (organization Settings → Danger zone),
 * so it isn't offered here (AUTH-40).
 *
 * The dialog runs the deletion itself: the website's name must be typed, and a
 * failure stays in the dialog to retry or cancel. A deletion that finishes
 * after the person left, closed the dialog, or signed in as someone else
 * changes nothing on screen.
 */
export function DangerZone({ project, organization }: { project: Project; organization?: SwitcherOrganization }) {
  const t = useT();
  const { deleteWebsite } = useDeleteWebsite(organization?.id);
  const navigate = useNavigate();
  const { data: session } = useSession();
  const [open, setOpen] = useState(false);

  // What a finished deletion checks before it toasts or navigates.
  const mounted = useRef(true);
  const run = useRef(0);
  const userId = useRef(session?.user.id);
  userId.current = session?.user.id;
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const changeOpen = (next: boolean) => {
    // Opening or closing starts a new run; a completion from an earlier one is ignored.
    run.current += 1;
    setOpen(next);
  };

  return (
    <div className="flex flex-col gap-8">
      <PageHeader title={t('settings.danger.title')} />
      <SettingsSection tone="destructive">
        <SettingsRow
          control="compact"
          description={
            organization
              ? t('settings.danger.delete.websiteDescription', { org: isolate(organization.name) })
              : t('settings.danger.delete.description')
          }
          label={t('settings.danger.delete.title')}
        >
          {() => (
            <Button onClick={() => changeOpen(true)} type="button" variant="destructive">
              {t('settings.danger.delete.button')}
            </Button>
          )}
        </SettingsRow>
      </SettingsSection>
      <ActionDialog
        cancelLabel={t('common.cancel')}
        confirmLabel={t('settings.danger.delete.button')}
        confirmText={project.name}
        confirmTextLabel={t('settings.danger.delete.typeToConfirm', { name: isolate(project.name) })}
        confirmTextMismatch={t('settings.danger.delete.nameMismatch')}
        description={t('settings.danger.delete.confirm', { name: isolate(project.name) })}
        destructive
        errorMessage={(error) => friendlyErrorMessage(t, error, 'settings.danger.delete.toast.error')}
        fallbackErrorMessage={t('settings.danger.delete.toast.error')}
        onConfirm={async () => {
          const start = { run: run.current, userId: userId.current };
          await deleteWebsite(project.id);
          if (!completionStillApplies(start, { run: run.current, userId: userId.current, mounted: mounted.current })) return;
          toast.success(t('settings.danger.delete.toast.deleted'));
          // The organization remains: back to its Websites.
          if (organization) void navigate({ to: '/app/o/$orgSlug/websites', params: { orgSlug: organization.slug } });
          else void navigate({ to: '/app' });
        }}
        onOpenChange={changeOpen}
        open={open}
        title={t('settings.danger.delete.title')}
      />
    </div>
  );
}
