import { Button } from '@nibleaf/design-system/components/ui/button';
import { Input } from '@nibleaf/design-system/components/ui/input';
import { Label } from '@nibleaf/design-system/components/ui/label';
import { cn } from '@nibleaf/design-system/lib/utils';
import { useForm } from '@tanstack/react-form';
import { ArrowUpRight, Check, CircleAlert, DownloadCloud, GitBranch, Globe, Hammer, Loader2 } from 'lucide-react';
import { type ReactNode, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { GithubIcon } from '@/components/icons/brand';
import type { Deployment } from '@/hooks/api';
import { useBranches, useDeployments, useImportFromGit, useLanguages, useUpdateWorkspaceSettings, useWorkspaceSettings } from '@/hooks/api';
import { useFormatters } from '@/lib/format';
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

/** The repository's web URL for the configured provider, if derivable. */
const repoWebUrl = (git: GitConfig): string | null => {
  if (git.provider === 'github' && git.repo) {
    return `https://github.com/${git.repo}`;
  }
  if (git.provider === 'gitlab' && git.repo) {
    return `${(git.instanceUrl || 'https://gitlab.com').replace(/\/+$/, '')}/${git.repo}`;
  }
  if (git.provider === 'git' && git.cloneUrl) {
    // Only http(s) clone URLs have a browsable web equivalent — hide the
    // "Open repository" button for ssh://, git://, etc.
    try {
      const { protocol } = new URL(git.cloneUrl);
      if (protocol === 'http:' || protocol === 'https:') {
        return git.cloneUrl.replace(/\.git$/, '');
      }
    } catch {
      // fall through — unparseable URL, no web link
    }
  }
  return null;
};

type StepTone = 'done' | 'active' | 'failed' | 'idle';

function PipelineStep({
  icon,
  tone,
  label,
  detail,
  action,
  last,
}: {
  icon: ReactNode;
  tone: StepTone;
  label: string;
  detail: string;
  action?: ReactNode;
  last?: boolean;
}) {
  return (
    <div className="relative flex gap-3 pb-6 last:pb-0">
      {!last ? <span className="absolute start-[15px] top-8 bottom-0 w-px bg-border" aria-hidden /> : null}
      <span
        className={cn(
          'z-10 grid size-8 shrink-0 place-items-center rounded-full border',
          tone === 'done' && 'border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
          tone === 'active' && 'border-primary/40 bg-primary/10 text-primary',
          tone === 'failed' && 'border-destructive/40 bg-destructive/10 text-destructive',
          tone === 'idle' && 'border-border bg-muted/40 text-muted-foreground',
        )}
      >
        {icon}
      </span>
      <div className="flex min-w-0 flex-1 items-center justify-between gap-3 pt-0.5">
        <div className="min-w-0 leading-snug">
          <div className="font-medium text-sm">{label}</div>
          <div className="truncate text-muted-foreground text-xs">{detail}</div>
        </div>
        {action}
      </div>
    </div>
  );
}

/** Import → Build → Live, from real git metadata + deployment history. */
function GitPipeline({ projectId, git, onImport, importing }: { projectId: string; git: GitConfig; onImport: () => void; importing: boolean }) {
  const t = useT();
  const { dateTime } = useFormatters();
  const { data: deployments } = useDeployments(projectId);
  const latest: Deployment | undefined = deployments?.[0];
  const latestReady = deployments?.find((d) => d.status === 'READY');

  const buildTone: StepTone =
    latest?.status === 'FAILED' ? 'failed' : latest?.status === 'PENDING' || latest?.status === 'BUILDING' ? 'active' : latest ? 'done' : 'idle';
  const buildDetail =
    latest?.status === 'PENDING' || latest?.status === 'BUILDING'
      ? t('settings.git.pipeline.building', { version: latest.version })
      : latest?.status === 'FAILED'
        ? t('settings.git.pipeline.failed', { version: latest.version })
        : latest
          ? t('settings.git.pipeline.built', { version: latest.version, pages: latest.pagesCount })
          : t('settings.git.pipeline.noBuilds');

  return (
    <SettingsSection title={t('settings.git.pipeline.title')}>
      <div className="flex flex-col">
        <PipelineStep
          icon={<DownloadCloud className="size-4" />}
          tone={git.lastImportedAt ? 'done' : 'idle'}
          label={t('settings.git.pipeline.import')}
          detail={git.lastImportedAt ? t('settings.git.import.lastImported', { when: dateTime(git.lastImportedAt) }) : t('settings.git.import.never')}
          action={
            <Button size="sm" type="button" variant="outline" disabled={importing} onClick={onImport}>
              {importing ? <Loader2 className="size-3.5 animate-spin" /> : <DownloadCloud className="size-3.5" />}
              {importing ? t('settings.git.import.importing') : t('settings.git.import.now')}
            </Button>
          }
        />
        <PipelineStep
          icon={
            latest?.status === 'FAILED' ? (
              <CircleAlert className="size-4" />
            ) : latest?.status === 'PENDING' || latest?.status === 'BUILDING' ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Hammer className="size-4" />
            )
          }
          tone={buildTone}
          label={t('settings.git.pipeline.build')}
          detail={buildDetail}
        />
        <PipelineStep
          icon={latestReady ? <Check className="size-4" /> : <Globe className="size-4" />}
          tone={latestReady ? 'done' : 'idle'}
          label={t('settings.git.pipeline.live')}
          detail={
            latestReady
              ? t('settings.git.pipeline.built', { version: latestReady.version, pages: latestReady.pagesCount })
              : t('settings.git.pipeline.notLive')
          }
          action={
            latestReady ? (
              <Button
                nativeButton={false}
                size="sm"
                variant="outline"
                render={
                  // biome-ignore lint/a11y/useAnchorContent: content is merged from the Button children via Base UI's render prop
                  <a href={`/sites/${projectId}`} rel="noreferrer" target="_blank" />
                }
              >
                {t('settings.git.pipeline.viewSite')} <ArrowUpRight className="size-3.5" />
              </Button>
            ) : undefined
          }
          last
        />
      </div>
    </SettingsSection>
  );
}

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

  const webUrl = repoWebUrl(git);
  const ProviderGlyph = git.provider === 'github' ? GithubIcon : GitBranch;

  const connectForm = (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        form.handleSubmit();
      }}
    >
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
                  className="h-9 w-full rounded-md border border-input bg-transparent px-2.5 font-mono text-sm shadow-xs outline-none transition-[color,box-shadow] focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-input/30"
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
                  className="h-9 w-full rounded-md border border-input bg-transparent px-2.5 font-mono text-sm shadow-xs outline-none transition-[color,box-shadow] focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-input/30"
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
            <Button disabled={isSubmitting} type="submit" variant={connected ? 'outline' : 'default'}>
              {isSubmitting ? t('common.saving') : connected ? t('settings.git.save') : t('settings.git.connect')}
            </Button>
          )}
        </form.Subscribe>
      </div>
    </form>
  );

  if (!connected) {
    return (
      <div className="flex flex-col gap-6">
        {/* Empty state: what connecting does, then the connect form. */}
        <section className="rounded-xl border border-border border-dashed bg-muted/20 p-6 text-center">
          <span className="mx-auto grid size-12 place-items-center rounded-xl bg-foreground/10 text-foreground">
            <GithubIcon className="size-6" />
          </span>
          <h2 className="mt-3 font-semibold text-lg tracking-tight">{t('settings.git.connectTitle')}</h2>
          <p className="mx-auto mt-1 max-w-md text-muted-foreground text-sm leading-relaxed">{t('settings.git.oneWayNote')}</p>
        </section>
        <SettingsSection title={t('settings.git.repository.title')} description={t('settings.git.import.description')}>
          {connectForm}
        </SettingsSection>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Connected status card */}
      <section className="rounded-xl border border-border bg-card p-5">
        <div className="flex items-center gap-4">
          <span className="grid size-12 shrink-0 place-items-center rounded-xl bg-foreground/10 text-foreground">
            <ProviderGlyph className="size-6" />
          </span>
          <div className="min-w-0 flex-1 leading-snug">
            <div className="truncate font-mono font-semibold text-sm tracking-tight">{git.provider === 'git' ? git.cloneUrl : git.repo}</div>
            <p className="mt-0.5 flex items-center gap-1.5 text-muted-foreground text-xs">
              <GitBranch className="size-3" /> {git.branch}
              <span aria-hidden>·</span>
              <span className="font-mono">/{git.path}</span>
            </p>
          </div>
          <span className="inline-flex items-center gap-1.5 rounded-4xl border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1 font-medium text-emerald-700 text-xs dark:text-emerald-400">
            <span className="size-1.5 rounded-full bg-emerald-500" /> {t('settings.integrations.connected')}
          </span>
          {webUrl ? (
            <Button
              nativeButton={false}
              size="sm"
              variant="ghost"
              render={
                // biome-ignore lint/a11y/useAnchorContent: content is merged from the Button children via Base UI's render prop
                <a href={webUrl} rel="noreferrer" target="_blank" />
              }
            >
              {t('settings.git.openRepo')} <ArrowUpRight className="size-3.5" />
            </Button>
          ) : null}
        </div>
      </section>

      {projectId ? <GitPipeline projectId={projectId} git={git} onImport={runImport} importing={importFromGit.isPending} /> : null}

      <SettingsSection title={t('settings.git.settingsTitle')} description={t('settings.git.import.description')}>
        {connectForm}
      </SettingsSection>
    </div>
  );
}
