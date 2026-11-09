import { Button } from '@nibleaf/design-system/components/ui/button';
import { useConfirm } from '@nibleaf/design-system/components/ui/confirm';
import { Input } from '@nibleaf/design-system/components/ui/input';
import { Label } from '@nibleaf/design-system/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@nibleaf/design-system/components/ui/select';
import { Switch } from '@nibleaf/design-system/components/ui/switch';
import { cn } from '@nibleaf/design-system/lib/utils';
import { useT } from '@nibleaf/i18n/react';
import { useForm } from '@tanstack/react-form';
import { ArrowUpRight, Check, CircleAlert, Copy, DownloadCloud, Eye, EyeOff, GitBranch, Globe, Hammer, Loader2, RefreshCw } from 'lucide-react';
import { type ReactNode, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { GithubIcon } from '@/components/icons/brand';
import { DirtyStateReporter, SettingsFormSkeleton } from '@/components/project-settings/shared';
import { QueryErrorState } from '@/components/query-error-state';
import type { Deployment } from '@/hooks/api';
import {
  useBranches,
  useDeployments,
  useGitWorkflow,
  useImportFromGit,
  useLanguages,
  useLiveDeployments,
  useRotateGitWebhookSecret,
  useUpdateWorkspaceSettings,
  useWorkspaceSettings,
} from '@/hooks/api';
import { newestLiveDeployment } from '@/hooks/api/deployment-cache';
import { useFormatters } from '@/lib/format';
import { githubRepositoryPath } from '@/lib/git-repository';
import { copyToClipboard } from '@/lib/invitations';
import { GitWorkflow, type GitWorkflowPrefill } from './git-workflow';
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
  /** Publish automatically after each push-webhook sync. */
  autoPublish?: boolean;
  // Server-managed (read-only here): the PATCH schema strips them, and the
  // server carries them over on every save.
  webhookSecret?: string;
  lastSyncAt?: string;
  lastSyncStatus?: 'ok' | 'failed';
  lastSyncError?: string;
}

const DEFAULTS: Required<
  Omit<GitConfig, 'lastImportedAt' | 'connected' | 'autoPublish' | 'webhookSecret' | 'lastSyncAt' | 'lastSyncStatus' | 'lastSyncError'>
> = {
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
      {/* On a narrow screen the action drops below the text, and the detail wraps
          instead of being cut off mid-word. */}
      <div className="flex min-w-0 flex-1 flex-col items-start gap-2 pt-0.5 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
        <div className="min-w-0 leading-snug">
          <div className="font-medium text-sm">{label}</div>
          <div className="text-muted-foreground text-xs [overflow-wrap:anywhere] sm:truncate">{detail}</div>
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
  // What's live comes from the live-only list too: the attempts list is the
  // newest 50, which a run of failures can fill.
  const { data: liveDeployments } = useLiveDeployments(projectId);
  const latest: Deployment | undefined = deployments?.[0];
  const latestReady = newestLiveDeployment(deployments, liveDeployments);

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

  // Prefer the push-webhook sync over the manual import when it is the more
  // recent of the two (ISO timestamps compare lexicographically). A failed
  // push sync never updates lastImportedAt, so it stays the latest and shows.
  const pushSyncIsLatest = Boolean(git.lastSyncAt && (!git.lastImportedAt || git.lastSyncAt >= git.lastImportedAt));
  const pushSyncFailed = pushSyncIsLatest && git.lastSyncStatus === 'failed';
  const importTone: StepTone = pushSyncFailed ? 'failed' : git.lastImportedAt || git.lastSyncAt ? 'done' : 'idle';
  const importDetail = pushSyncFailed
    ? `${t('settings.git.pipeline.syncFailed', { when: dateTime(git.lastSyncAt ?? '') })}${git.lastSyncError ? ` — ${git.lastSyncError}` : ''}`
    : pushSyncIsLatest
      ? t('settings.git.pipeline.lastSync', { when: dateTime(git.lastSyncAt ?? '') })
      : git.lastImportedAt
        ? t('settings.git.import.lastImported', { when: dateTime(git.lastImportedAt) })
        : t('settings.git.import.never');

  return (
    <SettingsSection title={t('settings.git.pipeline.title')}>
      <div className="flex flex-col">
        <PipelineStep
          icon={pushSyncFailed ? <CircleAlert className="size-4" /> : <DownloadCloud className="size-4" />}
          tone={importTone}
          label={t('settings.git.pipeline.import')}
          detail={importDetail}
          action={
            <Button size="sm" type="button" variant="outline" loading={importing} onClick={onImport} loadingText={t('settings.git.import.importing')}>
              <DownloadCloud className="size-3.5" />
              {t('settings.git.import.now')}
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
              <Button nativeButton={false} size="sm" variant="outline" render={<a href={`/sites/${projectId}`} rel="noreferrer" target="_blank" />}>
                {t('settings.git.pipeline.viewSite')} <ArrowUpRight className="size-3.5 rtl:-scale-x-100" />
              </Button>
            ) : undefined
          }
          last
        />
      </div>
    </SettingsSection>
  );
}

/** Numbered badge for the webhook setup steps ("done" renders a check). */
function StepBadge({ done, children }: { done?: boolean; children?: ReactNode }) {
  return (
    <span
      className={cn(
        'grid size-8 shrink-0 place-items-center rounded-full border font-medium text-xs',
        done ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400' : 'border-border bg-muted/40 text-muted-foreground',
      )}
    >
      {done ? <Check className="size-4" /> : children}
    </span>
  );
}

/**
 * Push-to-deploy setup, Mintlify-style: Mintlify's GitHub App redeploys docs on
 * every push to the deployment branch; the self-hosted equivalent is a standard
 * repository webhook pointed at this project's public webhook URL and signed
 * with a per-project secret. Steps: connect (done — this card only renders when
 * connected) → add the webhook → toggle auto-publish.
 */
function DeployOnPush({
  projectId,
  git,
  onToggleAutoPublish,
  togglingAutoPublish,
}: {
  projectId: string;
  git: GitConfig;
  onToggleAutoPublish: (next: boolean) => void;
  togglingAutoPublish: boolean;
}) {
  const t = useT();
  const rotateSecret = useRotateGitWebhookSecret(projectId);
  const [revealed, setRevealed] = useState(false);
  const [copying, setCopying] = useState(false);
  const [webhookOrigin, setWebhookOrigin] = useState('');
  useEffect(() => setWebhookOrigin(window.location.origin), []);
  const webhookUrl = `${webhookOrigin}/api/public/git/webhook/${projectId}`;
  const secret = git.webhookSecret ?? '';

  const copy = async (text: string) => {
    setCopying(true);
    const ok = await copyToClipboard(text);
    setCopying(false);
    if (ok) {
      toast.success(t('settings.git.webhook.copied'));
    } else {
      toast.error(t('settings.git.webhook.copyError'));
    }
  };

  const rotate = () =>
    rotateSecret.mutate(undefined, {
      onSuccess: () => {
        setRevealed(true);
        toast.success(t('settings.git.webhook.rotated'));
      },
      onError: (_error) => toast.error(t('settings.git.webhook.rotateError')),
    });

  const instructions =
    git.provider === 'gitlab'
      ? t('settings.git.webhook.instructions.gitlab')
      : git.provider === 'git'
        ? t('settings.git.webhook.instructions.git')
        : t('settings.git.webhook.instructions.github');

  return (
    <SettingsSection title={t('settings.git.webhook.title')} description={t('settings.git.webhook.description')}>
      <ol className="flex flex-col gap-6">
        <li className="flex gap-3">
          <StepBadge done />
          <div className="min-w-0 pt-0.5 leading-snug">
            <div className="font-medium text-sm">{t('settings.git.webhook.stepConnect')}</div>
            <div className="text-muted-foreground text-xs">{t('settings.git.webhook.stepConnectDone', { branch: git.branch || 'main' })}</div>
          </div>
        </li>

        <li className="flex gap-3">
          <StepBadge done={Boolean(secret)}>2</StepBadge>
          <div className="min-w-0 flex-1 pt-0.5 leading-snug">
            <div className="font-medium text-sm">{t('settings.git.webhook.stepWebhook')}</div>
            <div className="text-muted-foreground text-xs">{t('settings.git.webhook.stepWebhookDetail')}</div>
            <div className="mt-3 flex flex-col gap-3">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="git-webhook-url">{t('settings.git.webhook.url')}</Label>
                <div className="flex gap-2">
                  <Input className="font-mono" dir="ltr" id="git-webhook-url" readOnly value={webhookUrl} />
                  <Button
                    aria-label={t('settings.git.webhook.copy')}
                    loading={copying}
                    onClick={() => copy(webhookUrl)}
                    size="icon"
                    type="button"
                    variant="outline"
                  >
                    <Copy className="size-4" />
                  </Button>
                </div>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="git-webhook-secret">{t('settings.git.webhook.secret')}</Label>
                {secret ? (
                  <div className="flex gap-2">
                    <Input className="font-mono" dir="ltr" id="git-webhook-secret" readOnly type={revealed ? 'text' : 'password'} value={secret} />
                    <Button
                      aria-label={revealed ? t('settings.git.webhook.hide') : t('settings.git.webhook.reveal')}
                      onClick={() => setRevealed((value) => !value)}
                      size="icon"
                      type="button"
                      variant="outline"
                    >
                      {revealed ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                    </Button>
                    <Button
                      aria-label={t('settings.git.webhook.copy')}
                      loading={copying}
                      onClick={() => copy(secret)}
                      size="icon"
                      type="button"
                      variant="outline"
                    >
                      <Copy className="size-4" />
                    </Button>
                    <Button loading={rotateSecret.isPending} onClick={rotate} type="button" variant="outline">
                      <RefreshCw className="size-3.5" />
                      {t('settings.git.webhook.rotate')}
                    </Button>
                  </div>
                ) : (
                  <div className="flex items-center gap-3">
                    <Button loading={rotateSecret.isPending} onClick={rotate} type="button" variant="outline">
                      <RefreshCw className="size-3.5" />
                      {t('settings.git.webhook.generate')}
                    </Button>
                    <span className="text-muted-foreground text-xs">{t('settings.git.webhook.noSecret')}</span>
                  </div>
                )}
              </div>
              <p className="text-muted-foreground text-xs leading-relaxed">{instructions}</p>
            </div>
          </div>
        </li>

        <li className="flex gap-3">
          <StepBadge done={git.autoPublish === true}>3</StepBadge>
          <div className="flex min-w-0 flex-1 items-center justify-between gap-3 pt-0.5">
            <div className="min-w-0 leading-snug">
              <div className="font-medium text-sm">{t('settings.git.webhook.stepAutoPublish')}</div>
              <div className="text-muted-foreground text-xs">{t('settings.git.webhook.autoPublishDetail')}</div>
            </div>
            <Switch
              aria-label={t('settings.git.webhook.stepAutoPublish')}
              checked={git.autoPublish === true}
              disabled={togglingAutoPublish}
              onCheckedChange={(checked) => onToggleAutoPublish(checked)}
            />
          </div>
        </li>
      </ol>
    </SettingsSection>
  );
}

export function GitTab({ projectId }: { projectId?: string }) {
  const t = useT();
  const confirm = useConfirm();
  const workflow = useGitWorkflow(projectId ?? '');
  const [prefill, setPrefill] = useState<GitWorkflowPrefill | null>(null);
  const settings = useWorkspaceSettings(projectId);
  const { data } = settings;
  const update = useUpdateWorkspaceSettings(projectId);
  const importFromGit = useImportFromGit(projectId ?? '');
  const { data: branches } = useBranches(projectId);
  const { data: languages } = useLanguages(projectId);
  const branchOptions: Array<{ value: string | null; label: string }> = [
    { value: null, label: t('settings.git.defaultBranch') },
    ...(branches ?? []).map((branch) => ({ value: branch.id, label: branch.name })),
  ];
  const languageOptions: Array<{ value: string | null; label: string }> = [
    { value: null, label: t('settings.git.defaultLanguage') },
    ...(languages ?? []).map((language) => ({ value: language.id, label: `${language.label} (${language.code})` })),
  ];
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
          // The PATCH replaces `git` wholesale, so carry the flags a partial
          // save must not flip (webhook fields are preserved server-side).
          connected: git.connected,
          autoPublish: git.autoPublish,
          ...patch,
        },
      },
      {
        onSuccess: () => message && toast.success(message),
        onError: (_error) => toast.error(t('settings.git.saveError')),
      },
    );

  const runImport = () =>
    importFromGit.mutate(undefined, {
      onSuccess: (summary) => toast.success(t('settings.git.import.result', { imported: summary.imported, updated: summary.updated })),
      onError: (_error) => toast.error(t('settings.git.import.error')),
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

  if (settings.isPending) return <SettingsFormSkeleton />;
  if (settings.isError && !data) return <QueryErrorState onRetry={() => void settings.refetch()} retrying={settings.isFetching} />;

  const webUrl = repoWebUrl(git);
  const ProviderGlyph = git.provider === 'github' ? GithubIcon : GitBranch;

  const connectForm = (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        form.handleSubmit();
      }}
    >
      <form.Subscribe selector={(state) => !state.isDefaultValue}>
        {(dirty) => <DirtyStateReporter dirty={dirty || provider !== (git.provider ?? 'github')} />}
      </form.Subscribe>
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
                dir="ltr"
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
                dir="ltr"
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
                dir="ltr"
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
                dir="ltr"
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
                dir="ltr"
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
                <Select items={branchOptions} onValueChange={(next) => field.handleChange(next ?? '')} value={field.state.value || null}>
                  <SelectTrigger className="w-full font-mono" dir="ltr" id="git-import-branch">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent dir="ltr">
                    {branchOptions.map((option) => (
                      <SelectItem key={option.value ?? ''} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
          </form.Field>
          <form.Field name="importLanguageId">
            {(field) => (
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="git-import-language">{t('settings.git.importLanguage')}</Label>
                <Select items={languageOptions} onValueChange={(next) => field.handleChange(next ?? '')} value={field.state.value || null}>
                  <SelectTrigger className="w-full" id="git-import-language">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {languageOptions.map((option) => (
                      <SelectItem key={option.value ?? ''} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
          </form.Field>
        </div>
      ) : null}
      <div className="mt-5 flex items-center justify-between gap-3">
        {connected ? (
          <Button
            loading={update.isPending}
            type="button"
            variant="destructive"
            onClick={async () => {
              // Never one click: say which repository and that this is the one-way import.
              const approved = await confirm({
                title: t('settings.git.import.disconnectTitle', { repository: (git.provider === 'git' ? git.cloneUrl : git.repo) ?? '' }),
                description: t('settings.git.import.disconnectBody'),
                confirmLabel: t('settings.git.disconnect'),
                destructive: true,
              });
              if (approved) save({ connected: false }, t('settings.git.disconnectedToast'));
            }}
          >
            {t('settings.git.disconnect')}
          </Button>
        ) : (
          <span />
        )}
        <form.Subscribe selector={(state) => state.isSubmitting}>
          {(isSubmitting) => (
            <Button
              loading={update.isPending || isSubmitting}
              loadingText={t('common.saving')}
              type="submit"
              variant={connected ? 'outline' : 'default'}
            >
              {connected ? t('settings.git.save') : t('settings.git.connect')}
            </Button>
          )}
        </form.Subscribe>
      </div>
    </form>
  );

  const legacyControls = (
    <div className="flex flex-col gap-6">
      <section className="rounded-xl border border-border bg-card p-4 sm:p-5">
        {/* Wraps on phones so the repository name keeps its own line. */}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <span className="grid size-12 shrink-0 place-items-center rounded-xl bg-foreground/10 text-foreground">
            <ProviderGlyph className="size-6" />
          </span>
          <div className="min-w-0 flex-1 basis-40 leading-snug">
            <div className="truncate font-mono font-semibold text-sm tracking-tight" dir="ltr">
              {git.provider === 'git' ? git.cloneUrl : git.repo}
            </div>
            <p className="mt-0.5 flex items-center gap-1.5 text-muted-foreground text-xs">
              <GitBranch className="size-3" /> <span dir="ltr">{git.branch}</span>
              <span aria-hidden>·</span>
              <span className="font-mono" dir="ltr">
                /{git.path}
              </span>
            </p>
          </div>
          <span className="inline-flex items-center gap-1.5 rounded-4xl border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1 font-medium text-emerald-700 text-xs dark:text-emerald-400">
            <span className="size-1.5 rounded-full bg-emerald-500" /> {t('settings.integrations.connected')}
          </span>
          {webUrl ? (
            <Button nativeButton={false} size="sm" variant="ghost" render={<a href={webUrl} rel="noreferrer" target="_blank" />}>
              {t('settings.git.openRepo')} <ArrowUpRight className="size-3.5 rtl:-scale-x-100" />
            </Button>
          ) : null}
        </div>
      </section>

      {projectId ? <GitPipeline projectId={projectId} git={git} onImport={runImport} importing={importFromGit.isPending} /> : null}
      {projectId ? (
        <DeployOnPush
          projectId={projectId}
          git={git}
          onToggleAutoPublish={(next) => save({ autoPublish: next }, t('settings.git.webhook.autoPublishSaved'))}
          togglingAutoPublish={update.isPending}
        />
      ) : null}
      <SettingsSection title={t('settings.git.settingsTitle')} description={t('settings.git.import.description')}>
        {connectForm}
      </SettingsSection>
    </div>
  );

  // Legacy one-way import (workspace `metadata.git`), shown only while a site still uses it.
  const legacyRepository = git.provider === 'git' ? git.cloneUrl : git.repo;
  const switchable = git.provider === 'github' && Boolean(githubRepositoryPath(git.repo));
  const replaced = Boolean(workflow.data);
  const switchToNewConnection = () => {
    setPrefill({ key: Date.now(), repository: githubRepositoryPath(git.repo) ?? '', baseBranch: git.branch ?? 'main', contentPath: git.path ?? '' });
    document.getElementById('git-connection')?.scrollIntoView({ block: 'start' });
    toast.success(t('settings.git.legacy.switchStarted'));
  };
  const removeLegacy = async () => {
    const approved = await confirm({
      title: t('settings.git.import.disconnectTitle', { repository: legacyRepository ?? '' }),
      description: t('settings.git.import.disconnectBody'),
      confirmLabel: t('settings.git.disconnect'),
      destructive: true,
    });
    if (approved) save({ connected: false }, t('settings.git.disconnectedToast'));
  };
  const legacySettings = connected ? (
    <section
      aria-labelledby="git-legacy-title"
      className="rounded-xl border border-border border-dashed bg-muted/10 p-3 sm:p-5"
      data-testid="git-legacy"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="font-semibold text-sm" id="git-legacy-title">
            {t('settings.git.legacy.title')}
          </h3>
          <p className="mt-1 text-muted-foreground text-sm">
            {t(replaced ? 'settings.git.legacy.replaced' : switchable ? 'settings.git.legacy.switchable' : 'settings.git.legacy.readOnly', {
              repository: legacyRepository ?? '',
            })}
          </p>
        </div>
        {replaced ? (
          <Button loading={update.isPending} onClick={() => void removeLegacy()} type="button" variant="outline">
            {t('settings.git.legacy.remove')}
          </Button>
        ) : switchable ? (
          <Button onClick={switchToNewConnection} type="button">
            {t('settings.git.legacy.switch')}
          </Button>
        ) : null}
      </div>
      {replaced ? null : <div className="mt-5">{legacyControls}</div>}
    </section>
  ) : null;

  return (
    <div className="flex flex-col gap-6">
      {/* The one place to connect, sync and disconnect Git for this site. */}
      {projectId ? (
        <div className="scroll-mt-6" id="git-connection">
          <GitWorkflow
            onConnected={() => {
              // The new connection takes over: switch the legacy import off.
              if (connected) save({ connected: false }, t('settings.git.legacy.switched'));
            }}
            prefill={prefill}
            projectId={projectId}
          />
        </div>
      ) : null}
      {legacySettings}
    </div>
  );
}
