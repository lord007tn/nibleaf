import { useForm } from '@tanstack/react-form';
import { Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { FieldError } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useWorkspaceSettings } from '@/hooks/api';
import type { ActiveWorkspace } from '@/hooks/use-active-workspace';
import { authClient } from '@/lib/auth-client';
import { required } from '@/lib/form';
import { SettingsSection } from './section';

function WorkspaceNameForm({ workspaceId, initialName }: { workspaceId: string; initialName: string }) {
  const form = useForm({
    defaultValues: { name: initialName },
    onSubmit: async ({ value }) => {
      const { error } = await authClient.organization.update({ data: { name: value.name }, organizationId: workspaceId });
      if (error) {
        toast.error(error.message ?? 'Could not save');
        return;
      }
      toast.success('Workspace updated');
    },
  });

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        form.handleSubmit();
      }}
    >
      <form.Field name="name" validators={{ onChange: ({ value }) => required('Workspace name')(value) }}>
        {(field) => (
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="ws-name">Workspace name</Label>
            <Input id="ws-name" onBlur={field.handleBlur} onChange={(e) => field.handleChange(e.target.value)} value={field.state.value} />
            <FieldError errors={field.state.meta.errors} />
          </div>
        )}
      </form.Field>
      <div className="mt-4 flex justify-end">
        <form.Subscribe selector={(state) => state.isSubmitting}>
          {(isSubmitting) => (
            <Button disabled={isSubmitting} type="submit">
              {isSubmitting ? 'Saving…' : 'Save'}
            </Button>
          )}
        </form.Subscribe>
      </div>
    </form>
  );
}

/** Subtle bordered plan summary shown inline within the Workspace card. */
function PlanInline() {
  const { data } = useWorkspaceSettings();
  const plan = data?.plan ?? 'Free';
  const projectCount = data?.projectCount ?? 0;
  const memberCount = data?.memberCount ?? 0;

  return (
    <div className="mt-5 flex items-center gap-4 rounded-lg border border-border bg-muted/40 p-4">
      <div className="flex-1 leading-snug">
        <div className="flex items-center gap-2">
          <span className="font-semibold text-sm">{plan} plan</span>
          <Badge variant="secondary">{plan}</Badge>
        </div>
        <p className="mt-1 text-muted-foreground text-sm">
          {projectCount} {projectCount === 1 ? 'project' : 'projects'} · {memberCount} {memberCount === 1 ? 'member' : 'members'} · unlimited
          pageviews · custom domains
        </p>
      </div>
      <Button variant="outline" onClick={() => toast.info('Billing portal coming soon')}>
        Manage plan
      </Button>
    </div>
  );
}

function DangerZone({ workspace }: { workspace: ActiveWorkspace | null }) {
  const deleteWorkspace = async () => {
    if (!workspace) {
      return;
    }
    if (!confirm('Delete this workspace and all of its sites? This cannot be undone.')) {
      return;
    }
    const { error } = await authClient.organization.delete({ organizationId: workspace.id });
    if (error) {
      toast.error(error.message ?? 'Could not delete the workspace');
      return;
    }
    toast.success('Workspace deleted');
    window.location.assign('/app');
  };

  return (
    <section className="rounded-xl border border-destructive/30 bg-destructive/5 p-5">
      <h2 className="font-medium text-destructive">Danger zone</h2>
      <div className="mt-1 flex items-center gap-4">
        <p className="flex-1 text-muted-foreground text-sm leading-relaxed">
          Deleting your workspace removes all projects, docs, and analytics for everyone. This cannot be undone.
        </p>
        <Button disabled={!workspace} variant="destructive" onClick={deleteWorkspace}>
          <Trash2 className="size-4" /> Delete workspace
        </Button>
      </div>
    </section>
  );
}

export function WorkspaceTab({ workspace }: { workspace: ActiveWorkspace | null }) {
  return (
    <div className="flex flex-col gap-6">
      <SettingsSection title="Workspace" description="Settings that apply to everyone in this workspace.">
        {workspace ? (
          <WorkspaceNameForm key={workspace.id} initialName={workspace.name ?? ''} workspaceId={workspace.id} />
        ) : (
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="ws-name">Workspace name</Label>
            <Input disabled id="ws-name" value="" />
          </div>
        )}
        <PlanInline />
      </SettingsSection>
      <DangerZone workspace={workspace} />
    </div>
  );
}
