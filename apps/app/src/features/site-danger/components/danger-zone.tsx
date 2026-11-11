import { ActionDialog } from '@nibleaf/design-system/components/ui/action-dialog';
import { Button } from '@nibleaf/design-system/components/ui/button';
import { PageHeader } from '@nibleaf/design-system/components/ui/page-header';
import { SettingsRow } from '@nibleaf/design-system/components/ui/settings-row';
import { SettingsSection } from '@nibleaf/design-system/components/ui/settings-section';
import { useT } from '@nibleaf/i18n/react';
import { useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { toast } from 'sonner';
import type { Project, SwitcherOrganization } from '@/hooks/api';
import { useDeleteProject } from '@/hooks/api';
import { friendlyErrorMessage } from '@/hooks/api/errors';
import { isolate } from '@/lib/bidi';

/**
 * Website Danger zone: delete this website. Only the organization's Owner and
 * Admins reach it (the settings route decides `site.delete`). The organization
 * and its members remain, and the person lands on the organization's Websites.
 * Ownership is an organization matter (organization Settings → Danger zone),
 * so it isn't offered here (AUTH-40).
 *
 * The dialog runs the deletion itself: the website's name must be typed, and a
 * failure stays in the dialog to retry or cancel.
 */
export function DangerZone({ project, organization }: { project: Project; organization?: SwitcherOrganization }) {
  const t = useT();
  const remove = useDeleteProject();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
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
            <Button onClick={() => setOpen(true)} type="button" variant="destructive">
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
          await remove.mutateAsync(project.id);
          toast.success(t('settings.danger.delete.toast.deleted'));
          // The organization remains: back to its Websites.
          if (organization) void navigate({ to: '/app/o/$orgSlug/websites', params: { orgSlug: organization.slug } });
          else void navigate({ to: '/app' });
        }}
        onOpenChange={setOpen}
        open={open}
        title={t('settings.danger.delete.title')}
      />
    </div>
  );
}
