import { Button } from '@midad/design-system/components/ui/button';
import { Input } from '@midad/design-system/components/ui/input';
import { Label } from '@midad/design-system/components/ui/label';
import { useForm } from '@tanstack/react-form';
import { DownloadCloud, GitBranch, Loader2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { GithubIcon } from '@/components/icons/brand';
import { useBranches, useImportFromGit, useLanguages, useUpdateWorkspaceSettings, useWorkspaceSettings } from '@/hooks/api';
import { useT } from '@/lib/i18n';
import { SettingsSection } from './section';

interface GitConfig {
  provider?: 'github' | 'gitlab' | 'git';
  connected?: boolean;
  repo?: string;
  cloneUrl?: string;
  instanceUrl?: string;
  branch?: string;
  path?: string;
  importBranchId?: string;
  importLanguageId?: string;
  lastImportedAt?: string;
}

const DEFAULTS: Required<Omit<GitConfig, 'lastImportedAt' | 'connected'>> = {
  provider: 'github',
  repo: '',
  cloneUrl: '',
  instanceUrl: 'https://gitlab.com',
  branch: 'main',
  path: 'docs',
  importBranchId: '',
  importLanguageId: '',
};

export function GitTab({ projectId }: { projectId?: string }) {
  const t = useT();
  const { data } = useWorkspaceSettings(projectId);
  const update = useUpdateWorkspaceSettings(projectId);
  const importFromGit = useImportFromGit(projectId ?? '');
  const { data: branches } = useBranches(projectId);
  const { data: languages } = useLanguages(projectId);
  const git = { ...DEFAULTS, ...((data?.git ?? {}) as GitConfig) };
  const [provider, setProvider] = useState<GitConfig['provider']>(git.provider ?? 'github');
  const connected = Boolean((data?.git as GitConfig | undefined)?.connected && (git.provider === 'git' ? git.cloneUrl : git.repo));
  const isGitLab = provider === 'gitlab';
  const isGenericGit = provider === 'git';

  const save = (patch: Partial<GitConfig>, message?: string) =>
    update.mutate(
      {
        git: {
          provider,
          repo: git.repo,
          cloneUrl: git.cloneUrl,
          instanceUrl: git.instanceUrl,
          branch: git.branch,
          path: git.path,
          importBranchId: git.importBranchId,
          importLanguageId: git.importLanguageId,
          ...patch,
        },
      },
      {
        onSuccess: () => message && toast.success(message),
        onError: (error) => toast.error(error instanceof Error ? error.message : t('settings.git.saveError')),
      },
    );

  const runImport = () =>
    importFromGit.mutate(undefined, {
      onSuccess: (summary) => toast.success(t('settings.git.import.result', { imported: summary.imported, updated: summary.updated })),
      onError: (error) => toast.error(error instanceof Error ? error.message : t('settings.git.import.error')),
    });

  const form = useForm({
    defaultValues: {
      repo: git.repo,
      cloneUrl: git.cloneUrl,
      instanceUrl: git.instanceUrl,
      branch: git.branch,
      path: git.path,
      importBranchId: git.importBranchId,
      importLanguageId: git.importLanguageId,
    },
    onSubmit: async ({ value }) =>
      save(
        {
          provider,
          repo: provider === 'git' ? undefined : value.repo.trim(),
          cloneUrl: provider === 'git' ? value.cloneUrl.trim() : undefined,
          instanceUrl: provider === 'gitlab' ? value.instanceUrl.trim() || 'https://gitlab.com' : undefined,
          branch: value.branch.trim() || 'main',
          path: value.path.trim(),
          importBranchId: value.importBranchId || undefined,
          importLanguageId: value.importLanguageId || undefined,
          connected: true,
        },
        t('settings.git.repoSaved'),
      ),
  });

  useEffect(() => {
    setProvider(git.provider ?? 'github');
    form.reset({
      repo: git.repo,
      cloneUrl: git.cloneUrl,
      instanceUrl: git.instanceUrl,
      branch: git.branch,
      path: git.path,
      importBranchId: git.importBranchId,
      importLanguageId: git.importLanguageId,
    });
  }, [form, git.branch, git.cloneUrl, git.importBranchId, git.importLanguageId, git.instanceUrl, git.path, git.provider, git.repo]);

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
              {isGitLab || isGenericGit ? <GitBranch className="size-5" /> : <GithubIcon className="size-5" />}
            </span>
            <p className="text-muted-foreground text-sm leading-snug">{t('settings.git.oneWayNote')}</p>
          </div>

          <div className="mb-4 grid grid-cols-3 gap-2">
            <Button
              className="justify-start"
              onClick={() => setProvider('github')}
              type="button"
              variant={provider === 'github' ? 'secondary' : 'outline'}
            >
              <GithubIcon className="size-4" />
              GitHub
            </Button>
            <Button
              className="justify-start"
              onClick={() => setProvider('gitlab')}
              type="button"
              variant={provider === 'gitlab' ? 'secondary' : 'outline'}
            >
              <GitBranch className="size-4" />
              GitLab
            </Button>
            <Button className="justify-start" onClick={() => setProvider('git')} type="button" variant={provider === 'git' ? 'secondary' : 'outline'}>
              <GitBranch className="size-4" />
              {t('settings.git.provider.git.name')}
            </Button>
          </div>

          {isGitLab ? (
            <form.Field name="instanceUrl">
              {(field) => (
                <div className="mb-4 flex flex-col gap-1.5">
                  <Label htmlFor="git-instance-url">{t('settings.git.instanceUrl')}</Label>
                  <Input
                    className="font-mono"
                    id="git-instance-url"
                    onChange={(e) => field.handleChange(e.target.value)}
                    placeholder="https://gitlab.com"
                    value={field.state.value}
                  />
                </div>
              )}
            </form.Field>
          ) : null}

          {isGenericGit ? (
            <form.Field name="cloneUrl">
              {(field) => (
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="git-clone-url">{t('settings.git.cloneUrl')}</Label>
                  <Input
                    className="font-mono"
                    id="git-clone-url"
                    onChange={(e) => field.handleChange(e.target.value)}
                    placeholder="https://git.example.com/acme/docs.git"
                    value={field.state.value}
                  />
                </div>
              )}
            </form.Field>
          ) : (
            <form.Field name="repo">
              {(field) => (
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="git-repo">{t('settings.git.repoUrl')}</Label>
                  <Input
                    className="font-mono"
                    id="git-repo"
                    onChange={(e) => field.handleChange(e.target.value)}
                    placeholder={isGitLab ? 'group/project' : 'acme-inc/docs'}
                    value={field.state.value}
                  />
                </div>
              )}
            </form.Field>
          )}
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
          {projectId ? (
            <div className="mt-4 grid grid-cols-2 gap-4">
              <form.Field name="importBranchId">
                {(field) => (
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="git-import-branch">{t('settings.git.importBranch')}</Label>
                    <select
                      className="h-10 rounded-md border border-border bg-background px-3 font-mono text-sm"
                      id="git-import-branch"
                      onChange={(e) => field.handleChange(e.target.value)}
                      value={field.state.value ?? ''}
                    >
                      <option value="">{t('settings.git.defaultBranch')}</option>
                      {(branches ?? []).map((branch) => (
                        <option key={branch.id} value={branch.id}>
                          {branch.name}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
              </form.Field>
              <form.Field name="importLanguageId">
                {(field) => (
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="git-import-language">{t('settings.git.importLanguage')}</Label>
                    <select
                      className="h-10 rounded-md border border-border bg-background px-3 font-mono text-sm"
                      id="git-import-language"
                      onChange={(e) => field.handleChange(e.target.value)}
                      value={field.state.value ?? ''}
                    >
                      <option value="">{t('settings.git.defaultLanguage')}</option>
                      {(languages ?? []).map((language) => (
                        <option key={language.id} value={language.id}>
                          {language.label} ({language.code})
                        </option>
                      ))}
                    </select>
                  </div>
                )}
              </form.Field>
            </div>
          ) : null}
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
            <Button type="button" disabled={importFromGit.isPending} onClick={runImport}>
              {importFromGit.isPending ? <Loader2 className="size-4 animate-spin" /> : <DownloadCloud className="size-4" />}
              {importFromGit.isPending
                ? t('settings.git.import.importing')
                : t('settings.git.import.button', { provider: git.provider === 'gitlab' ? 'GitLab' : git.provider === 'git' ? 'Git' : 'GitHub' })}
            </Button>
          </div>
        </SettingsSection>
      ) : null}
    </div>
  );
}
