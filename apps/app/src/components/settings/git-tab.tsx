import { useForm } from '@tanstack/react-form';
import { toast } from 'sonner';
import { GithubIcon, GitlabIcon } from '@/components/icons/brand';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { useUpdateWorkspaceSettings, useWorkspaceSettings } from '@/hooks/api';
import { cn } from '@/lib/utils';
import { SettingsSection } from './section';

interface GitConfig {
  provider: 'github' | 'gitlab';
  connected: boolean;
  repo: string;
  branch: string;
  path: string;
  twoWaySync: boolean;
}

const DEFAULTS: GitConfig = {
  provider: 'github',
  connected: false,
  repo: '',
  branch: 'main',
  path: '/docs',
  twoWaySync: true,
};

const PROVIDERS = [
  { id: 'github' as const, name: 'Connect to GitHub', description: 'Connect an org and host content on GitHub', icon: GithubIcon, tint: 'bg-foreground/10 text-foreground' },
  { id: 'gitlab' as const, name: 'Connect to GitLab', description: 'Configure your GitLab repository', icon: GitlabIcon, tint: 'bg-orange-500/15 text-orange-600 dark:text-orange-400' },
];

export function GitTab() {
  const { data } = useWorkspaceSettings();
  const update = useUpdateWorkspaceSettings();
  const git = { ...DEFAULTS, ...((data?.git ?? {}) as Partial<GitConfig>) };

  const save = (patch: Partial<GitConfig>, message?: string) =>
    update.mutate(
      { git: { ...git, ...patch } },
      {
        onSuccess: () => {
          if (message) {
            toast.success(message);
          }
        },
        onError: (error) => toast.error(error instanceof Error ? error.message : 'Could not save Git settings'),
      },
    );

  const form = useForm({
    defaultValues: { repo: git.repo, branch: git.branch, path: git.path },
    onSubmit: async ({ value }) => save({ ...value, connected: true }, 'Repository saved'),
  });

  return (
    <div className="flex flex-col gap-6">
      <SettingsSection title="Git access" description="Manage your docs as files in a Git repository. Edits sync both ways between Plume and your provider.">
        <div className="flex flex-col gap-3">
          {PROVIDERS.map((provider) => {
            const selected = git.provider === provider.id;
            const Icon = provider.icon;
            return (
              <button
                key={provider.id}
                className={cn(
                  'flex w-full items-center gap-4 rounded-lg border p-4 text-start transition-colors',
                  selected ? 'border-primary bg-primary/5' : 'border-border hover:bg-muted/40',
                )}
                onClick={() => save({ provider: provider.id, connected: true }, `Connected to ${provider.id === 'github' ? 'GitHub' : 'GitLab'}`)}
                type="button"
              >
                <span className={`grid size-10 shrink-0 place-items-center rounded-lg ${provider.tint}`}>
                  <Icon className="size-5" />
                </span>
                <span className="min-w-0 flex-1 leading-snug">
                  <span className="block font-medium text-sm">{provider.name}</span>
                  <span className="block text-muted-foreground text-sm">{provider.description}</span>
                </span>
                <span
                  className={cn('size-4 shrink-0 rounded-full border', selected ? 'border-[5px] border-primary' : 'border-input')}
                  aria-hidden
                />
              </button>
            );
          })}
        </div>
      </SettingsSection>

      {git.connected ? (
        <SettingsSection
          title="Repository"
          action={<Badge className="bg-emerald-500/15 text-emerald-600 dark:text-emerald-400">Connected</Badge>}
        >
          <form
            onSubmit={(event) => {
              event.preventDefault();
              form.handleSubmit();
            }}
          >
            <form.Field name="repo">
              {(field) => (
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="git-repo">Repository URL</Label>
                  <Input
                    className="font-mono"
                    id="git-repo"
                    onChange={(e) => field.handleChange(e.target.value)}
                    placeholder="acme-inc/docs"
                    value={field.state.value}
                  />
                </div>
              )}
            </form.Field>
            <div className="mt-4 grid grid-cols-2 gap-4">
              <form.Field name="branch">
                {(field) => (
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="git-branch">Production branch</Label>
                    <Input className="font-mono" id="git-branch" onChange={(e) => field.handleChange(e.target.value)} value={field.state.value} />
                  </div>
                )}
              </form.Field>
              <form.Field name="path">
                {(field) => (
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="git-path">Content path</Label>
                    <Input className="font-mono" id="git-path" onChange={(e) => field.handleChange(e.target.value)} value={field.state.value} />
                  </div>
                )}
              </form.Field>
            </div>
            <div className="mt-5 flex items-center gap-4 border-border border-t pt-5">
              <div className="min-w-0 flex-1 leading-snug">
                <div className="font-medium text-sm">Two-way auto-sync</div>
                <p className="mt-0.5 text-muted-foreground text-sm">Pushes to the branch publish automatically.</p>
              </div>
              <Switch checked={git.twoWaySync} disabled={update.isPending} onCheckedChange={(checked) => save({ twoWaySync: checked })} />
            </div>
            <div className="mt-5 flex justify-between">
              <Button
                type="button"
                variant="destructive"
                onClick={() => save({ connected: false }, 'Disconnected')}
              >
                Disconnect
              </Button>
              <form.Subscribe selector={(state) => state.isSubmitting}>
                {(isSubmitting) => (
                  <Button disabled={isSubmitting} type="submit">
                    {isSubmitting ? 'Saving…' : 'Save'}
                  </Button>
                )}
              </form.Subscribe>
            </div>
          </form>
        </SettingsSection>
      ) : null}
    </div>
  );
}
