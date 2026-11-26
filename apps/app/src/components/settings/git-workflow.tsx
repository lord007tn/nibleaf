import { Alert, AlertDescription, AlertTitle } from '@nibleaf/design-system/components/ui/alert';
import { Button } from '@nibleaf/design-system/components/ui/button';
import { useConfirm } from '@nibleaf/design-system/components/ui/confirm';
import { Input } from '@nibleaf/design-system/components/ui/input';
import { Label } from '@nibleaf/design-system/components/ui/label';
import { SettingsSection, SettingsSectionBody } from '@nibleaf/design-system/components/ui/settings-section';
import { Skeleton } from '@nibleaf/design-system/components/ui/skeleton';
import { StatusBadge } from '@nibleaf/design-system/components/ui/status-badge';
import { useLocale } from '@nibleaf/i18n/react';
import { AlertTriangle, Check, ExternalLink, GitCommit, GitPullRequest, RefreshCw, ShieldCheck } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { SecretInput } from '@/components/secret-input';
import { env } from '@/env';
import { GitConflictCard } from '@/features/site-git/components/git-conflict-card';
import { GitWorkflowConnectionForm } from '@/features/site-git/components/git-workflow-connection-form';
import { GitPullRequestPreviews, GitRecentOperations, GitWorkflowStatusHeader } from '@/features/site-git/components/git-workflow-readouts';
import { useGitAuthorizationCommand } from '@/features/site-git/components/use-git-authorization-command';
import { useGitFirstConnectCommand } from '@/features/site-git/components/use-git-first-connect-command';
import { useGitOperationCommand } from '@/features/site-git/components/use-git-operation-command';
import { useGitWebhookRotateCommand } from '@/features/site-git/components/use-git-webhook-rotate-command';
import { connectBlocker, GITHUB_NEW_TOKEN_URL, GITHUB_TOKEN_PERMISSIONS, MIN_TOKEN_LENGTH } from '@/features/site-git/model/git-access';
import { friendlyErrorMessage, useDisconnectGitWorkflow, useGitWorkflow } from '@/hooks/api';

type GitIdentity = { login: string; name: string | null };

/**
 * First load. Whether the site is connected is only known once this load
 * answers (the import settings above can't tell), and both answers are common:
 * new sites aren't connected, while connected sites are the usual revisit. So
 * the placeholder is the part both screens share — a header (icon, title and a
 * line under it) over one plain panel — and never shows the connect page's
 * token and repository sections (a connected writer would read them as "my
 * repository was disconnected") or the four connected actions (which a new site
 * never has).
 */
function GitWorkflowSkeleton() {
  const { t } = useLocale();
  return (
    <section aria-busy="true" className="flex flex-col gap-6" data-slot="git-workflow-skeleton">
      <p className="sr-only" role="status">
        {t('common.loading')}
      </p>
      <div aria-hidden className="flex flex-col gap-6">
        <div className="rounded-xl border border-border bg-muted/20 p-5" data-slot="git-workflow-skeleton-header">
          <div className="flex items-start gap-3">
            <Skeleton className="size-10 shrink-0 rounded-xl" />
            <div className="w-full max-w-2xl space-y-2">
              <Skeleton className="h-5 w-48 max-w-full" />
              <Skeleton className="h-4 w-full" />
            </div>
          </div>
        </div>
        <div className="rounded-xl border border-border bg-card p-5 shadow-sm sm:p-6" data-slot="git-workflow-skeleton-body">
          <div className="max-w-2xl space-y-2">
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-2/3" />
          </div>
          <Skeleton className="mt-5 h-10 w-full rounded-md sm:w-40" />
        </div>
      </div>
    </section>
  );
}

/** Repository details carried over from legacy import settings; `key` changes per request. */
export interface GitWorkflowPrefill {
  key: number;
  repository: string;
  baseBranch: string;
  contentPath: string;
}

export function GitWorkflow({
  projectId,
  prefill,
  onConnected,
}: {
  projectId: string;
  /** Fills the connect form (switching from legacy import settings). */
  prefill?: GitWorkflowPrefill | null;
  /** Called once the new connection is saved. */
  onConnected?: () => void;
}) {
  const { t } = useLocale();
  const [repository, setRepository] = useState('');
  const [baseBranch, setBaseBranch] = useState('main');
  const [headBranch, setHeadBranch] = useState('nibleaf/docs');
  const [contentPath, setContentPath] = useState('docs');
  const [token, setToken] = useState('');
  const [authorizedAccount, setAuthorizedAccount] = useState<GitIdentity | null>(null);
  const [message, setMessage] = useState('Update documentation');
  const [authorName, setAuthorName] = useState('Nibleaf author');
  const [authorEmail, setAuthorEmail] = useState('docs@example.com');
  const [prTitle, setPrTitle] = useState('Update documentation');
  const [webhookSecret, setWebhookSecret] = useState<string | null>(null);
  const [intent, setIntent] = useState<'overview' | 'sync' | 'publish' | 'connection'>('overview');
  const query = useGitWorkflow(projectId);
  const connection = query.data;
  // The connect wizard shows only once the status says the site is not connected.
  const authorize = useGitAuthorizationCommand({ projectId, shown: !query.isPending && !query.isError && !connection });
  const connect = useGitFirstConnectCommand(projectId, {
    connected: (result, sent) => {
      setWebhookSecret(result.webhookSecret);
      // A token typed since the press is kept, with the account checked for it.
      if (token === sent.token) {
        setToken('');
        setAuthorizedAccount(null);
      }
      toast.success(t('settings.git.workflow.connected'));
      onConnected?.();
    },
    // A 409: someone else connected the site meanwhile; the refreshed status now shows their connection.
    failed: (error) =>
      toast.error(friendlyErrorMessage(t, error, 'settings.git.workflow.connectError', { 409: 'settings.git.workflow.savedElsewhere' })),
  });
  const disconnect = useDisconnectGitWorkflow(projectId);
  // The operation panel shown: none while the status loads or failed to load (that screen replaces it).
  const shownPanel = !query.isPending && !query.isError && connection && (intent === 'sync' || intent === 'publish') ? intent : null;
  const operation = useGitOperationCommand({ projectId, panel: shownPanel });
  const confirm = useConfirm();
  const rotation = useGitWebhookRotateCommand(projectId, {
    confirm: () =>
      confirm({
        title: t('settings.git.workflow.rotateConfirm.title'),
        description: t('settings.git.workflow.rotateConfirm.description'),
        confirmLabel: t('settings.git.workflow.rotateSecret'),
        destructive: true,
      }),
    rotated: setWebhookSecret,
    failed: (error) => toast.error(friendlyErrorMessage(t, error, 'settings.git.workflow.rotateError')),
  });
  const operationFailed = (error: unknown) => toast.error(friendlyErrorMessage(t, error, 'settings.git.workflow.operationError'));
  const activeConflicts = useMemo(
    () => connection?.operations.flatMap((item) => item.conflicts.filter((conflict) => conflict.status === 'OPEN')) ?? [],
    [connection],
  );
  const webhookUrl = new URL(`/api/public/git/webhook/${projectId}`, env.VITE_APP_URL).toString();

  // A switch from legacy settings: the same repository, branch and folder, ready to authorize.
  const [appliedPrefill, setAppliedPrefill] = useState<number | null>(null);
  if (prefill && !connection && appliedPrefill !== prefill.key) {
    setAppliedPrefill(prefill.key);
    setRepository(prefill.repository);
    setBaseBranch(prefill.baseBranch || 'main');
    setContentPath(prefill.contentPath);
  }

  useEffect(() => {
    if (!connection) return;
    setRepository(connection.repository);
    setBaseBranch(connection.baseBranch);
    setHeadBranch(connection.headBranch);
    setContentPath(connection.contentPath);
  }, [connection]);

  if (query.isPending) return <GitWorkflowSkeleton />;
  if (query.isError) {
    return (
      <Alert variant="destructive">
        <AlertTriangle />
        <AlertTitle>{t('settings.git.workflow.loadError')}</AlertTitle>
        <AlertDescription className="flex flex-wrap items-center justify-between gap-3">
          <span>{t('settings.git.workflow.loadErrorHint')}</span>
          <Button loading={query.isFetching} onClick={() => query.refetch()} size="sm" variant="outline">
            {t('common.retry')}
          </Button>
        </AlertDescription>
      </Alert>
    );
  }
  if (!connection) {
    const blocker = connectBlocker({ accountChecked: Boolean(authorizedAccount), repository, baseBranch, headBranch });
    const tokenTooShort = token.trim().length < MIN_TOKEN_LENGTH;
    return (
      <div className="flex flex-col gap-8" data-slot="git-connect">
        {/* How Nibleaf reaches GitHub: a token today; a GitHub App would be offered here too (model/git-access.ts). */}
        <SettingsSection description={t('settings.git.connect.accessDescription')} title={t('settings.git.connect.accessTitle')}>
          <SettingsSectionBody className="flex flex-col gap-4">
            <ol className="flex list-decimal flex-col gap-3 ps-5 text-sm marker:text-muted-foreground">
              <li>
                <p>{t('settings.git.connect.stepCreate')}</p>
                <Button
                  className="mt-2"
                  nativeButton={false}
                  render={<a href={GITHUB_NEW_TOKEN_URL} rel="noreferrer" target="_blank" />}
                  size="sm"
                  variant="outline"
                >
                  {t('settings.git.connect.createToken')}
                  <ExternalLink aria-hidden className="size-3.5" />
                </Button>
              </li>
              <li>
                <p>{t('settings.git.connect.stepPermissions')}</p>
                <ul className="mt-1.5 flex flex-col gap-1 text-muted-foreground">
                  {GITHUB_TOKEN_PERMISSIONS.map((permission) => (
                    <li className="flex items-center gap-2" key={permission}>
                      <Check aria-hidden className="size-3.5 shrink-0 text-success" />
                      <bdi>{t(permission)}</bdi>
                    </li>
                  ))}
                </ul>
              </li>
              <li>
                <p>{t('settings.git.connect.stepPaste')}</p>
              </li>
            </ol>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="git2-token">{t('settings.git.workflow.token')}</Label>
              <div className="flex flex-col gap-2 sm:flex-row sm:items-start">
                <SecretInput
                  aria-describedby="git2-token-hint"
                  className="min-w-0 flex-1"
                  id="git2-token"
                  name="github-access-token"
                  onChange={(e) => {
                    setToken(e.target.value);
                    setAuthorizedAccount(null);
                    authorize.retire();
                  }}
                  placeholder="github_pat_…"
                  value={token}
                />
                <Button
                  className="w-full sm:w-auto"
                  disabled={tokenTooShort}
                  loading={authorize.busy}
                  loadingText={t('settings.git.workflow.authorizing')}
                  onClick={() => authorize.verify(token, (identity) => setAuthorizedAccount(identity))}
                  type="button"
                  variant={authorizedAccount ? 'outline' : 'default'}
                >
                  {t('settings.git.workflow.authorize')}
                </Button>
              </div>
              <p className="text-muted-foreground text-xs" id="git2-token-hint">
                {t('settings.git.connect.tokenHint')}
              </p>
              {authorize.failed ? (
                <p aria-live="polite" className="text-destructive text-sm">
                  {t('settings.git.workflow.authorizeError')}
                </p>
              ) : null}
              {authorizedAccount ? (
                <p className="flex flex-wrap items-center gap-2 text-sm" role="status">
                  <span>
                    {t('settings.git.workflow.authorizedAs')} <strong dir="ltr">@{authorizedAccount.login}</strong>
                    {authorizedAccount.name ? (
                      <span className="text-muted-foreground">
                        {' '}
                        · <bdi>{authorizedAccount.name}</bdi>
                      </span>
                    ) : null}
                  </span>
                  <StatusBadge tone="success">{t('settings.git.workflow.verified')}</StatusBadge>
                </p>
              ) : null}
            </div>
          </SettingsSectionBody>
        </SettingsSection>

        <SettingsSection description={t('settings.git.workflow.chooseDescription')} title={t('settings.git.workflow.chooseTitle')}>
          <SettingsSectionBody className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="git2-repo">{t('settings.git.repository.title')}</Label>
              <Input
                className="font-mono"
                dir="ltr"
                id="git2-repo"
                onChange={(e) => setRepository(e.target.value)}
                placeholder="owner/docs"
                value={repository}
              />
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="git2-base">{t('settings.git.workflow.baseBranch')}</Label>
                <Input
                  aria-describedby="git2-base-hint"
                  className="font-mono"
                  dir="ltr"
                  id="git2-base"
                  onChange={(e) => setBaseBranch(e.target.value)}
                  value={baseBranch}
                />
                <p className="text-muted-foreground text-xs" id="git2-base-hint">
                  {t('settings.git.connect.baseHint')}
                </p>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="git2-head">{t('settings.git.workflow.headBranch')}</Label>
                <Input
                  aria-describedby="git2-head-hint"
                  className="font-mono"
                  dir="ltr"
                  id="git2-head"
                  onChange={(e) => setHeadBranch(e.target.value)}
                  value={headBranch}
                />
                <p className="text-muted-foreground text-xs" id="git2-head-hint">
                  {t('settings.git.connect.headHint')}
                </p>
              </div>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="git2-path">{t('settings.git.contentPath')}</Label>
              <Input
                className="font-mono"
                dir="ltr"
                id="git2-path"
                onChange={(e) => setContentPath(e.target.value)}
                placeholder="docs"
                value={contentPath}
              />
            </div>
            <p className="text-muted-foreground text-xs leading-5">{t('settings.git.workflow.reviewHint')}</p>
            <div className="flex flex-col items-stretch gap-2 sm:flex-row sm:items-center sm:justify-end">
              {blocker ? (
                <p className="text-muted-foreground text-sm sm:me-auto" id="git2-connect-reason">
                  {t(blocker)}
                </p>
              ) : null}
              <Button
                aria-describedby={blocker ? 'git2-connect-reason' : undefined}
                className="w-full sm:w-auto"
                disabled={Boolean(blocker) || !token}
                // Blocked, it stays in the tab order, so its reason (linked above) is read with it.
                focusableWhenDisabled
                loading={connect.busy}
                loadingText={t('settings.git.workflow.verifying')}
                onClick={() => connect.press({ repository, baseBranch, headBranch, contentPath, token: token || undefined, expectedRevision: null })}
              >
                {t('settings.git.workflow.connect')}
              </Button>
            </div>
          </SettingsSectionBody>
        </SettingsSection>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <GitWorkflowStatusHeader connection={connection} onRefresh={() => query.refetch()} refreshing={query.isFetching} />

      <nav aria-label={t('settings.git.workflow.actions')} className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        {(
          [
            ['overview', t('settings.git.workflow.nav.overview'), t('settings.git.workflow.nav.overviewDesc')],
            ['sync', t('settings.git.workflow.nav.sync'), t('settings.git.workflow.nav.syncDesc')],
            ['publish', t('settings.git.workflow.nav.publish'), t('settings.git.workflow.nav.publishDesc')],
            ['connection', t('settings.git.workflow.nav.connection'), t('settings.git.workflow.nav.connectionDesc')],
          ] as const
        ).map(([value, label, description]) => (
          <button
            aria-pressed={intent === value}
            className={`rounded-lg border p-3 text-start transition-colors ${intent === value ? 'border-primary bg-primary/5' : 'hover:bg-muted/50'}`}
            key={value}
            onClick={() => setIntent(value)}
            type="button"
          >
            <span className="block font-medium text-sm">{label}</span>
            <span className="mt-1 block text-muted-foreground text-xs">{description}</span>
          </button>
        ))}
      </nav>

      {activeConflicts.length > 0 ? (
        <section className="space-y-3">
          <div>
            <h3 className="font-semibold">{t('settings.git.workflow.conflict.title')}</h3>
            <p className="text-muted-foreground text-sm">{t('settings.git.workflow.conflict.description')}</p>
          </div>
          {activeConflicts.map((conflict) => (
            <GitConflictCard conflict={conflict} key={conflict.id} projectId={projectId} />
          ))}
        </section>
      ) : null}

      {intent === 'sync' ? (
        <section className="rounded-xl border p-5">
          <div className="flex items-center gap-2">
            <RefreshCw className="size-5" />
            <h3 className="font-semibold">{t('settings.git.workflow.syncTitle')}</h3>
          </div>
          <p className="mt-1 text-muted-foreground text-sm">
            {t('settings.git.workflow.syncDescriptionBefore')} <code>{connection.baseBranch}</code> {t('settings.git.workflow.syncDescriptionAfter')}
          </p>
          <Button
            className="mt-4"
            disabled={activeConflicts.length > 0}
            loading={operation.busy}
            onClick={() => operation.sync(connection.baseBranch, operationFailed)}
          >
            <RefreshCw className="size-4" />{' '}
            {connection.lastSyncedAt ? t('settings.git.workflow.syncLatest') : t('settings.git.workflow.importExisting')}
          </Button>
          {activeConflicts.length > 0 ? (
            <p className="mt-2 text-amber-700 text-xs dark:text-amber-300">{t('settings.git.workflow.resolveFirst')}</p>
          ) : null}
        </section>
      ) : null}

      {intent === 'publish' ? (
        <section className="rounded-xl border p-5">
          <div className="flex items-center gap-2">
            <GitCommit className="size-5" />
            <h3 className="font-semibold">{t('settings.git.workflow.publishTitle')}</h3>
          </div>
          <div className="mt-4 grid gap-4 md:grid-cols-2">
            <div className="md:col-span-2">
              <Label htmlFor="git2-message">{t('settings.git.workflow.commitMessage')}</Label>
              <Input id="git2-message" onChange={(e) => setMessage(e.target.value)} value={message} />
            </div>
            <div>
              <Label htmlFor="git2-author">{t('settings.git.workflow.authorName')}</Label>
              <Input id="git2-author" onChange={(e) => setAuthorName(e.target.value)} value={authorName} />
            </div>
            <div>
              <Label htmlFor="git2-email">{t('settings.git.workflow.authorEmail')}</Label>
              <Input id="git2-email" onChange={(e) => setAuthorEmail(e.target.value)} type="email" value={authorEmail} />
            </div>
            <div className="md:col-span-2">
              <Label htmlFor="git2-title">{t('settings.git.workflow.prTitle')}</Label>
              <Input id="git2-title" onChange={(e) => setPrTitle(e.target.value)} value={prTitle} />
            </div>
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            <Button
              loading={operation.busy}
              onClick={() => operation.updatePr({ commitMessage: message, authorName, authorEmail, pullRequestTitle: prTitle }, operationFailed)}
            >
              <GitPullRequest className="size-4" /> {t('settings.git.workflow.updatePr')}
            </Button>
          </div>
        </section>
      ) : null}

      {intent === 'overview' || intent === 'publish' ? <GitPullRequestPreviews pullRequests={connection.pullRequests} /> : null}

      {intent === 'connection' ? (
        <section className="rounded-xl border p-5">
          <h3 className="font-semibold">{t('settings.git.webhook.title')}</h3>
          <p className="text-muted-foreground text-sm">{t('settings.git.workflow.webhookDescription')}</p>
          <Label className="mt-3" htmlFor="git2-webhook">
            {t('settings.git.webhook.url')}
          </Label>
          <Input className="font-mono text-xs" id="git2-webhook" readOnly value={webhookUrl} />
          {webhookSecret ? (
            <Alert className="mt-3">
              <ShieldCheck />
              <AlertTitle>{t('settings.git.workflow.copySecret')}</AlertTitle>
              <AlertDescription className="break-all font-mono text-xs">{webhookSecret}</AlertDescription>
            </Alert>
          ) : null}
          <Button className="mt-3" loading={rotation.busy} onClick={() => void rotation.press()} size="sm" variant="outline">
            {t('settings.git.workflow.rotateSecret')}
          </Button>
        </section>
      ) : null}

      {/* Mounted while other panels show, so its edits and a save in flight outlive a panel switch. */}
      <GitWorkflowConnectionForm
        connection={connection}
        disconnect={
          <Button
            loading={disconnect.isPending}
            onClick={async () => {
              // The same localized dialog as every other destructive action, naming what it affects.
              const approved = await confirm({
                title: t('settings.git.workflow.disconnectTitle', { repository: connection.repository }),
                description: t('settings.git.workflow.disconnectConfirm'),
                confirmLabel: t('settings.git.disconnect'),
                destructive: true,
              });
              if (!approved) return;
              disconnect.mutate(undefined, {
                onSuccess: () => toast.success(t('settings.git.workflow.disconnected')),
                onError: (error) => toast.error(friendlyErrorMessage(t, error, 'settings.git.workflow.disconnectError')),
              });
            }}
            type="button"
            variant="destructive"
          >
            {t('settings.git.disconnect')}
          </Button>
        }
        hidden={intent !== 'connection'}
        onSaved={(result) => {
          setWebhookSecret(result.webhookSecret);
          onConnected?.();
        }}
        projectId={projectId}
      />

      {intent === 'overview' || intent === 'sync' ? <GitRecentOperations operations={connection.operations} /> : null}
    </div>
  );
}
