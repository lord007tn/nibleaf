import { Button } from '@nibleaf/design-system/components/ui/button';
import { useConfirm } from '@nibleaf/design-system/components/ui/confirm';
import { Input } from '@nibleaf/design-system/components/ui/input';
import { Label } from '@nibleaf/design-system/components/ui/label';
import { Switch } from '@nibleaf/design-system/components/ui/switch';
import { cn } from '@nibleaf/design-system/lib/utils';
import { useT } from '@nibleaf/i18n/react';
import { ArrowUpRight, Check, Copy, Eye, EyeOff, GitBranch, RefreshCw } from 'lucide-react';
import { type ReactNode, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { GithubIcon } from '@/components/icons/brand';
import { SettingsFormSkeleton } from '@/components/project-settings/shared';
import { QueryErrorState } from '@/components/query-error-state';
import { SecretInput } from '@/components/secret-input';
import { useWriteGitSettings } from '@/features/site-git/api/git-connection';
import { GitConnectionForm } from '@/features/site-git/components/git-connection-form';
import { GitPipeline } from '@/features/site-git/components/git-pipeline';
import { useGitImportCommand } from '@/features/site-git/components/use-git-import';
import { useGitSettingsWebhookRotateCommand } from '@/features/site-git/components/use-git-settings-webhook-rotate-command';
import { type GitInstantChange, gitInstantPayload } from '@/features/site-git/model/git-instant-write';
import { useGitWorkflow, useWorkspaceSettings } from '@/hooks/api';
import { githubRepositoryPath } from '@/lib/git-repository';
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
  webhookConfigured?: boolean;
  lastSyncAt?: string;
  lastSyncStatus?: 'ok' | 'failed';
  lastSyncError?: string;
}

const DEFAULTS: Required<
  Omit<GitConfig, 'lastImportedAt' | 'connected' | 'autoPublish' | 'webhookConfigured' | 'lastSyncAt' | 'lastSyncStatus' | 'lastSyncError'>
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
  const [revealed, setRevealed] = useState(false);
  // One rotation per press, outside every cache; reported only to this card, for this site and session.
  const rotateSecret = useGitSettingsWebhookRotateCommand(projectId, {
    rotated: () => {
      setRevealed(true);
      toast.success(t('settings.git.webhook.rotated'));
    },
    failed: (_error) => toast.error(t('settings.git.webhook.rotateError')),
    copied: (ok) => (ok ? toast.success(t('settings.git.webhook.copied')) : toast.error(t('settings.git.webhook.copyError'))),
  });
  const { copy, copying, secret } = rotateSecret;
  const configured = git.webhookConfigured === true || rotateSecret.configured;
  const [webhookOrigin, setWebhookOrigin] = useState('');
  useEffect(() => setWebhookOrigin(window.location.origin), []);
  const webhookUrl = `${webhookOrigin}/api/public/git/webhook/${projectId}`;

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
          <StepBadge done={configured}>2</StepBadge>
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
                    onClick={() => void copy(webhookUrl)}
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
                  <div className="flex flex-wrap gap-2">
                    <SecretInput
                      className="min-w-0 flex-1 basis-40"
                      id="git-webhook-secret"
                      masked={!revealed}
                      name="git-webhook-secret"
                      readOnly
                      value={secret}
                    />
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
                      onClick={() => void copy(secret)}
                      size="icon"
                      type="button"
                      variant="outline"
                    >
                      <Copy className="size-4" />
                    </Button>
                    <Button loading={rotateSecret.busy} onClick={() => void rotateSecret.press()} type="button" variant="outline">
                      <RefreshCw className="size-3.5" />
                      {t('settings.git.webhook.rotate')}
                    </Button>
                  </div>
                ) : (
                  <div className="flex flex-wrap items-center gap-3">
                    <Button loading={rotateSecret.busy} onClick={() => void rotateSecret.press()} type="button" variant="outline">
                      <RefreshCw className="size-3.5" />
                      {t(configured ? 'settings.git.webhook.rotate' : 'settings.git.webhook.generate')}
                    </Button>
                    <span className="text-muted-foreground text-xs">
                      {t(configured ? 'settings.git.webhook.configured' : 'settings.git.webhook.noSecret')}
                    </span>
                  </div>
                )}
              </div>
              {secret ? (
                <p className="text-muted-foreground text-xs leading-relaxed" role="status">
                  {t('settings.git.webhook.oneTime')}
                </p>
              ) : null}
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
  // The manual import: one per site at a time, reported only into this panel (see useGitImportCommand).
  const gitImport = useGitImportCommand(projectId ?? '');
  // Any write to this site's `git` in flight, from this mount or an earlier one: the instant writes
  // below and the repository form's save wait for each other (the PATCH replaces `git` whole).
  const { write, pending: writing, isPending: writePending } = useWriteGitSettings(projectId ?? '');
  const git = { ...DEFAULTS, ...((data?.git ?? {}) as GitConfig) };
  const connected = Boolean((data?.git as GitConfig | undefined)?.connected && (git.provider === 'git' ? git.cloneUrl : git.repo));

  // The instant writes (auto publish, disconnect): the stored connection as the server returned it, with
  // one change (`gitInstantPayload`), never the display defaults above or the repository form's draft.
  // One that the person asked for waits out any other write to this site's `git`; the new connection
  // taking over (`switchOff`) is sent regardless, as before.
  const send = (change: GitInstantChange, message?: string) => {
    if (!projectId) return;
    write(
      { projectId, git: gitInstantPayload(data?.git, change) },
      {
        onSuccess: () => message && toast.success(message),
        onError: (_error) => toast.error(t('settings.git.saveError')),
      },
    );
  };
  const save = (change: GitInstantChange, message?: string) => {
    if (!writePending()) send(change, message);
  };

  const runImport = () =>
    gitImport.start({
      succeeded: (summary) => toast.success(t('settings.git.import.result', { imported: summary.imported, updated: summary.updated })),
      failed: (_error) => toast.error(t('settings.git.import.error')),
    });

  if (settings.isPending) return <SettingsFormSkeleton />;
  if (settings.isError && !data) return <QueryErrorState onRetry={() => void settings.refetch()} retrying={settings.isFetching} />;

  const webUrl = repoWebUrl(git);
  const ProviderGlyph = git.provider === 'github' ? GithubIcon : GitBranch;

  const connectForm = projectId ? (
    <GitConnectionForm
      connected={connected}
      disconnect={
        connected ? (
          <Button
            loading={writing}
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
        ) : null
      }
      git={data?.git}
      projectId={projectId}
    />
  ) : null;

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

      {projectId ? <GitPipeline projectId={projectId} git={git} onImport={runImport} importing={gitImport.busy} /> : null}
      {projectId ? (
        <DeployOnPush
          projectId={projectId}
          git={git}
          onToggleAutoPublish={(next) => save({ autoPublish: next }, t('settings.git.webhook.autoPublishSaved'))}
          togglingAutoPublish={writing}
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
          <Button loading={writing} onClick={() => void removeLegacy()} type="button" variant="outline">
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
              if (connected) send({ connected: false }, t('settings.git.legacy.switched'));
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
