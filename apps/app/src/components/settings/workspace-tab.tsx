import { Badge } from '@nibleaf/design-system/components/ui/badge';
import { Button } from '@nibleaf/design-system/components/ui/button';
import { useConfirm } from '@nibleaf/design-system/components/ui/confirm';
import { FieldError } from '@nibleaf/design-system/components/ui/form-field';
import { Input } from '@nibleaf/design-system/components/ui/input';
import { Label } from '@nibleaf/design-system/components/ui/label';
import { useForm } from '@tanstack/react-form';
import { Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { useWorkspaceSettings } from '@/hooks/api';
import type { ActiveWorkspace } from '@/hooks/use-active-workspace';
import { authClient } from '@/lib/auth-client';
import { required } from '@/lib/form';
import { useT } from '@/lib/i18n';
import { SettingsSection } from './section';

function WorkspaceNameForm({ workspaceId, initialName }: { workspaceId: string; initialName: string }) {
  const t = useT();
  const form = useForm({
    defaultValues: { name: initialName },
    onSubmit: async ({ value }) => {
      const { error } = await authClient.organization.update({ data: { name: value.name }, organizationId: workspaceId });
      if (error) {
        toast.error(error.message ?? t('settings.workspace.toast.saveError'));
        return;
      }
      toast.success(t('settings.workspace.toast.updated'));
    },
  });

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        form.handleSubmit();
      }}
    >
      <form.Field name="name" validators={{ onChange: ({ value }) => required(t('settings.workspace.name'))(value) }}>
        {(field) => (
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="ws-name">{t('settings.workspace.name')}</Label>
            <Input id="ws-name" onBlur={field.handleBlur} onChange={(e) => field.handleChange(e.target.value)} value={field.state.value} />
            <FieldError errors={field.state.meta.errors} />
          </div>
        )}
      </form.Field>
      <div className="mt-4 flex justify-end">
        <form.Subscribe selector={(state) => state.isSubmitting}>
          {(isSubmitting) => (
            <Button disabled={isSubmitting} type="submit">
              {isSubmitting ? t('common.saving') : t('settings.workspace.save')}
            </Button>
          )}
        </form.Subscribe>
      </div>
    </form>
  );
}

/** Subtle bordered plan summary shown inline within the Workspace card. */
function PlanInline() {
  const t = useT();
  const { data } = useWorkspaceSettings();
  const plan = data?.plan ?? 'Free';
  const projectCount = data?.projectCount ?? 0;
  const memberCount = data?.memberCount ?? 0;

  return (
    <div className="mt-5 flex items-center gap-4 rounded-lg border border-border bg-muted/40 p-4">
      <div className="flex-1 leading-snug">
        <div className="flex items-center gap-2">
          <span className="font-semibold text-sm">{t('settings.workspace.planName', { plan })}</span>
          <Badge variant="secondary">{plan}</Badge>
        </div>
        <p className="mt-1 text-muted-foreground text-sm">
          {projectCount === 1
            ? t('settings.workspace.projectCount.one', { count: projectCount })
            : t('settings.workspace.projectCount.other', { count: projectCount })}{' '}
          · {memberCount === 1 ? t('settings.members.count.one', { count: memberCount }) : t('settings.members.count.other', { count: memberCount })}{' '}
          · {t('settings.workspace.planFeatures')}
        </p>
      </div>
    </div>
  );
}

function DangerZone({ workspace }: { workspace: ActiveWorkspace | null }) {
  const t = useT();
  const confirm = useConfirm();
  const deleteWorkspace = async () => {
    if (!workspace) {
      return;
    }
    const ok = await confirm({
      title: t('settings.workspace.delete.title'),
      description: t('settings.workspace.delete.description'),
      confirmLabel: t('settings.workspace.delete.confirm'),
      destructive: true,
    });
    if (!ok) {
      return;
    }
    const { error } = await authClient.organization.delete({ organizationId: workspace.id });
    if (error) {
      toast.error(error.message ?? t('settings.workspace.toast.deleteError'));
      return;
    }
    toast.success(t('settings.workspace.toast.deleted'));
    window.location.assign('/app');
  };

  return (
    <section className="rounded-xl border border-destructive/30 bg-destructive/5 p-5">
      <h2 className="font-medium text-destructive">{t('settings.workspace.dangerZone')}</h2>
      <div className="mt-1 flex items-center gap-4">
        <p className="flex-1 text-muted-foreground text-sm leading-relaxed">{t('settings.workspace.dangerDescription')}</p>
        <Button disabled={!workspace} variant="destructive" onClick={deleteWorkspace}>
          <Trash2 className="size-4" /> {t('settings.workspace.delete.button')}
        </Button>
      </div>
    </section>
  );
}

export function WorkspaceTab({ workspace }: { workspace: ActiveWorkspace | null }) {
  const t = useT();
  return (
    <div className="flex flex-col gap-6">
      <SettingsSection title={t('settings.workspace.title')} description={t('settings.workspace.description')}>
        {workspace ? (
          <WorkspaceNameForm key={workspace.id} initialName={workspace.name ?? ''} workspaceId={workspace.id} />
        ) : (
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="ws-name">{t('settings.workspace.name')}</Label>
            <Input disabled id="ws-name" value="" />
          </div>
        )}
        <PlanInline />
      </SettingsSection>
      <DangerZone workspace={workspace} />
    </div>
  );
}
