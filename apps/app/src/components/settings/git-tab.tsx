import { useForm } from '@tanstack/react-form';
import { DownloadCloud, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { GithubIcon } from '@/components/icons/brand';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useImportFromGitHub, useUpdateWorkspaceSettings, useWorkspaceSettings } from '@/hooks/api';
import { useT } from '@/lib/i18n';
import { SettingsSection } from './section';

interface GitConfig {
  provider?: 'github';
  connected?: boolean;
  repo?: string;
  branch?: string;
  path?: string;
  lastImportedAt?: string;
}

const DEFAULTS: Required<Omit<GitConfig, 'lastImportedAt' | 'connected'>> = {
  provider: 'github',
  repo: '',
  branch: 'main',
  path: 'docs',
};

export function GitTab({ projectId }: { projectId?: string }) {
  const t = useT();
  const { data } = useWorkspaceSettings(projectId);
  const update = useUpdateWorkspaceSettings(projectId);
  const importFromGitHub = useImportFromGitHub(projectId ?? '');
  const git = { ...DEFAULTS, ...((data?.git ?? {}) as GitConfig) };
  const connected = Boolean((data?.git as GitConfig | undefined)?.connected && git.repo);

  const save = (patch: Partial<GitConfig>, message?: string) =>
    update.mutate(
      { git: { provider: 'github', repo: git.repo, branch: git.branch, path: git.path, ...patch } },
      {
        onSuccess: () => message && toast.success(message),
        onError: (error) => toast.error(error instanceof Error ? error.message : t('settings.git.saveError')),
      },
    );

  const runImport = () =>
    importFromGitHub.mutate(undefined, {
      onSuccess: (summary) => toast.success(t('settings.git.import.result', { imported: summary.imported, updated: summary.updated })),
      onError: (error) => toast.error(error instanceof Error ? error.message : t('settings.git.import.error')),
    });

  const form = useForm({
    defaultValues: { repo: git.repo, branch: git.branch, path: git.path },
    onSubmit: async ({ value }) =>
      save({ repo: value.repo.trim(), branch: value.branch.trim() || 'main', path: value.path.trim(), connected: true }, t('settings.git.repoSaved')),
  });

  const lastImported = (data?.git as GitConfig | undefined)?.lastImportedAt;

  return (
    <div className="flex flex-col gap-6">
      <SettingsSection title={t('settings.git.repository.title')} description={t('settings.git.import.description')}>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            form.handleSubmit();
          }}
        >
          <div className="mb-4 flex items-center gap-3 rounded-lg border border-border bg-muted/30 p-3">
            <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-foreground/10 text-foreground">
              <GithubIcon className="size-5" />
            </span>
            <p className="text-muted-foreground text-sm leading-snug">{t('settings.git.oneWayNote')}</p>
          </div>

          <form.Field name="repo">
            {(field) => (
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="git-repo">{t('settings.git.repoUrl')}</Label>
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
                  <Label htmlFor="git-branch">{t('settings.git.productionBranch')}</Label>
                  <Input
                    className="font-mono"
                    id="git-branch"
                    onChange={(e) => field.handleChange(e.target.value)}
                    placeholder="main"
                    value={field.state.value}
                  />
                </div>
              )}
            </form.Field>
            <form.Field name="path">
              {(field) => (
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="git-path">{t('settings.git.contentPath')}</Label>
                  <Input
                    className="font-mono"
                    id="git-path"
                    onChange={(e) => field.handleChange(e.target.value)}
                    placeholder="docs"
                    value={field.state.value}
                  />
                </div>
              )}
            </form.Field>
          </div>
          <div className="mt-5 flex items-center justify-between gap-3">
            {connected ? (
              <Button type="button" variant="destructive" onClick={() => save({ connected: false }, t('settings.git.disconnectedToast'))}>
                {t('settings.git.disconnect')}
              </Button>
            ) : (
              <span />
            )}
            <form.Subscribe selector={(state) => state.isSubmitting}>
              {(isSubmitting) => (
                <Button disabled={isSubmitting} type="submit" variant="outline">
                  {isSubmitting ? t('common.saving') : t('settings.git.save')}
                </Button>
              )}
            </form.Subscribe>
          </div>
        </form>
      </SettingsSection>

      {connected ? (
        <SettingsSection title={t('settings.git.import.title')}>
          <div className="flex items-center justify-between gap-4">
            <p className="text-muted-foreground text-sm">
              {lastImported
                ? t('settings.git.import.lastImported', { when: new Date(lastImported).toLocaleString() })
                : t('settings.git.import.never')}
            </p>
            <Button type="button" disabled={importFromGitHub.isPending} onClick={runImport}>
              {importFromGitHub.isPending ? <Loader2 className="size-4 animate-spin" /> : <DownloadCloud className="size-4" />}
              {importFromGitHub.isPending ? t('settings.git.import.importing') : t('settings.git.import.button')}
            </Button>
          </div>
        </SettingsSection>
      ) : null}
    </div>
  );
}
