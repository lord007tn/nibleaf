import { Alert, AlertDescription, AlertTitle } from '@nibleaf/design-system/components/ui/alert';
import { Badge } from '@nibleaf/design-system/components/ui/badge';
import { Button } from '@nibleaf/design-system/components/ui/button';
import { useConfirm } from '@nibleaf/design-system/components/ui/confirm';
import { Input } from '@nibleaf/design-system/components/ui/input';
import { Label } from '@nibleaf/design-system/components/ui/label';
import { Skeleton } from '@nibleaf/design-system/components/ui/skeleton';
import { useLocale } from '@nibleaf/i18n/react';
import { AlertTriangle, ArrowLeft, ArrowRight, Check, GitCommit, GitPullRequest, RefreshCw, ShieldCheck } from 'lucide-react';
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
import { friendlyErrorMessage, useDisconnectGitWorkflow, useGitWorkflow } from '@/hooks/api';

type GitIdentity = { login: string; name: string | null };

/**
 * First load. Whether the site is connected is only known once this load
 * answers (the import settings above can't tell), and both answers are common:
 * new sites aren't connected, while connected sites are the usual revisit. So
 * the placeholder is the part both screens share — a header (icon, title and a
 * line under it) over one plain panel — and never shows the three connect steps
 * (a connected writer would read them as "my repository was disconnected") or
 * the four connected actions (which a new site never has).
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
  const [connectStep, setConnectStep] = useState<1 | 2 | 3>(1);
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
    setConnectStep(1);
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
    return (
      <section className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
        <header className="border-border border-b bg-muted/20 px-5 py-5 sm:px-6">
          <div className="flex items-start gap-3">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-xl border border-primary/20 bg-primary/10">
              <ShieldCheck className="size-5 text-primary" />
            </span>
            <div className="space-y-1">
              <h2 className="font-semibold text-base">{t('settings.git.workflow.connectTitle')}</h2>
              <p className="max-w-2xl text-muted-foreground text-sm leading-6">{t('settings.git.workflow.connectDescription')}</p>
            </div>
          </div>
        </header>

        <div className="space-y-6 p-5 sm:p-6">
          <ol aria-label={t('settings.git.workflow.progress')} className="grid gap-3 sm:grid-cols-3">
            {(
              [
                [t('settings.git.workflow.step.authorize'), t('settings.git.workflow.step.authorizeDesc')],
                [t('settings.git.workflow.step.repository'), t('settings.git.workflow.step.repositoryDesc')],
                [t('settings.git.workflow.step.review'), t('settings.git.workflow.step.reviewDesc')],
              ] as const
            ).map(([label, description], index) => {
              const step = (index + 1) as 1 | 2 | 3;
              const isActive = connectStep === step;
              const isComplete = connectStep > step;
              return (
                <li
                  aria-current={isActive ? 'step' : undefined}
                  className={`flex min-h-16 items-center gap-3 rounded-xl border p-3 ${
                    isActive
                      ? 'border-primary/50 bg-primary/5 text-foreground shadow-sm'
                      : isComplete
                        ? 'border-border bg-muted/30 text-foreground'
                        : 'border-border/80 bg-muted/10 text-muted-foreground'
                  }`}
                  key={label}
                >
                  <span
                    className={`flex size-7 shrink-0 items-center justify-center rounded-full font-semibold text-xs ${
                      isActive || isComplete ? 'bg-primary text-primary-foreground' : 'border border-border bg-background'
                    }`}
                  >
                    {isComplete ? <Check aria-hidden="true" className="size-4" /> : step}
                  </span>
                  <span className="min-w-0">
                    <span className="block font-medium text-sm leading-5">{label}</span>
                    <span className="block text-muted-foreground text-xs leading-4">{description}</span>
                  </span>
                </li>
              );
            })}
          </ol>

          <div className="rounded-xl border border-border bg-background p-5 shadow-sm sm:p-6">
            {connectStep === 1 ? (
              <div className="max-w-2xl space-y-5">
                <div className="space-y-1.5">
                  <h3 className="font-medium text-sm">{t('settings.git.workflow.authorizeTitle')}</h3>
                  <p className="text-muted-foreground text-sm leading-6">{t('settings.git.workflow.authorizeDescription')}</p>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="git2-token">{t('settings.git.workflow.token')}</Label>
                  <SecretInput
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
                </div>
                {authorize.failed ? (
                  <p aria-live="polite" className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-destructive text-sm">
                    {t('settings.git.workflow.authorizeError')}
                  </p>
                ) : null}
              </div>
            ) : null}
            {connectStep === 2 ? (
              <div className="space-y-5">
                <div className="space-y-1.5">
                  <h3 className="font-medium text-sm">{t('settings.git.workflow.chooseTitle')}</h3>
                  <p className="text-muted-foreground text-sm leading-6">{t('settings.git.workflow.chooseDescription')}</p>
                </div>
                <div className="grid gap-5 md:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="git2-repo">{t('settings.git.repository.title')}</Label>
                    <Input id="git2-repo" onChange={(e) => setRepository(e.target.value)} placeholder="owner/docs" value={repository} />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="git2-base">{t('settings.git.workflow.baseBranch')}</Label>
                    <Input id="git2-base" onChange={(e) => setBaseBranch(e.target.value)} value={baseBranch} />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="git2-head">{t('settings.git.workflow.headBranch')}</Label>
                    <Input id="git2-head" onChange={(e) => setHeadBranch(e.target.value)} value={headBranch} />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="git2-path">{t('settings.git.contentPath')}</Label>
                    <Input id="git2-path" onChange={(e) => setContentPath(e.target.value)} value={contentPath} />
                  </div>
                </div>
              </div>
            ) : null}
            {connectStep === 3 ? (
              <div className="space-y-5">
                <div className="space-y-1.5">
                  <h3 className="font-medium text-sm">{t('settings.git.workflow.reviewTitle')}</h3>
                  <p className="text-muted-foreground text-sm leading-6">{t('settings.git.workflow.reviewDescription')}</p>
                </div>
                {authorizedAccount ? (
                  <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-primary/30 bg-primary/5 px-4 py-3 text-sm">
                    <span>
                      {t('settings.git.workflow.authorizedAs')} <strong>@{authorizedAccount.login}</strong>
                      {authorizedAccount.name ? <span className="text-muted-foreground"> · {authorizedAccount.name}</span> : null}
                    </span>
                    <Badge variant="outline">{t('settings.git.workflow.verified')}</Badge>
                  </div>
                ) : null}
                <dl className="grid gap-3 text-sm sm:grid-cols-2">
                  {(
                    [
                      [t('settings.git.repository.title'), repository],
                      [t('settings.git.workflow.docsPath'), contentPath || '/'],
                      [t('settings.git.workflow.importFrom'), baseBranch],
                      [t('settings.git.workflow.writeTo'), headBranch],
                    ] as const
                  ).map(([label, value]) => (
                    <div className="rounded-lg border border-border bg-muted/20 p-3" key={label}>
                      <dt className="text-muted-foreground text-xs">{label}</dt>
                      <dd className="mt-1 break-all font-mono">{value}</dd>
                    </div>
                  ))}
                </dl>
                <p className="text-muted-foreground text-xs leading-5">{t('settings.git.workflow.reviewHint')}</p>
              </div>
            ) : null}
          </div>

          <div className="flex flex-col-reverse gap-3 border-border border-t pt-5 sm:flex-row sm:items-center sm:justify-between">
            <Button
              className="w-full sm:w-auto"
              disabled={connectStep === 1}
              onClick={() => setConnectStep((step) => Math.max(1, step - 1) as 1 | 2 | 3)}
              variant="outline"
            >
              <ArrowLeft className="size-4 rtl:-scale-x-100" /> {t('common.back')}
            </Button>
            {connectStep < 3 ? (
              connectStep === 1 ? (
                <Button
                  className="w-full sm:w-auto"
                  disabled={token.trim().length < 20}
                  loading={authorize.busy}
                  loadingText={t('settings.git.workflow.authorizing')}
                  onClick={() =>
                    authorize.verify(token, (identity) => {
                      setAuthorizedAccount(identity);
                      setConnectStep(2);
                    })
                  }
                >
                  {t('settings.git.workflow.authorize')} <ArrowRight className="size-4 rtl:-scale-x-100" />
                </Button>
              ) : (
                <Button
                  className="w-full sm:w-auto"
                  disabled={!authorizedAccount || !repository.trim() || !baseBranch.trim() || !headBranch.trim()}
                  onClick={() => setConnectStep(3)}
                >
                  {t('settings.git.workflow.review')} <ArrowRight className="size-4 rtl:-scale-x-100" />
                </Button>
              )
            ) : (
              <Button
                className="w-full sm:w-auto"
                disabled={!authorizedAccount || !repository || !token}
                loading={connect.busy}
                onClick={() => connect.press({ repository, baseBranch, headBranch, contentPath, token: token || undefined, expectedRevision: null })}
                loadingText={t('settings.git.workflow.verifying')}
              >
                {t('settings.git.workflow.connect')}
              </Button>
            )}
          </div>
        </div>
      </section>
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
