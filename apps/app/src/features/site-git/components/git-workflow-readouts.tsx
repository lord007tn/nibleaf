import { Alert, AlertDescription, AlertTitle } from '@nibleaf/design-system/components/ui/alert';
import { Badge } from '@nibleaf/design-system/components/ui/badge';
import { Button } from '@nibleaf/design-system/components/ui/button';
import { useLocale } from '@nibleaf/i18n/react';
import { AlertTriangle, ArrowUpRight, GitCompare, RefreshCw } from 'lucide-react';
import { FailureMessage } from '@/components/failure-message';
import type { GitWorkflowStatus } from '@/hooks/api';
import { localeTag } from '@/lib/format';
import { gitStatusTone } from '../model/git-status';

/**
 * The connected Git workflow's read-only parts: the status header, the pull
 * request previews and the recent operations. They render the status the host
 * already reads (one query, which polls while an operation runs) and own no
 * query or request; Refresh calls the host back.
 */

/** The repository, its branches and the last sync's status, with Refresh and the last sync's failure. */
export function GitWorkflowStatusHeader({
  connection,
  refreshing,
  onRefresh,
}: {
  connection: Pick<GitWorkflowStatus, 'repository' | 'baseBranch' | 'headBranch' | 'lastSyncStatus' | 'lastSyncError'>;
  /** The status is being read again (Refresh shows it busy). */
  refreshing: boolean;
  onRefresh: () => void;
}) {
  const { t } = useLocale();
  return (
    <section className="rounded-xl border border-primary/20 bg-primary/5 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <GitCompare className="size-5 text-primary" />
            <h2 className="font-semibold">{t('settings.git.workflow.title')}</h2>
            <Badge variant={gitStatusTone(connection.lastSyncStatus)}>{connection.lastSyncStatus}</Badge>
          </div>
          <p className="mt-1 font-mono text-sm">
            {connection.repository}: {connection.headBranch} → {connection.baseBranch}
          </p>
        </div>
        <Button loading={refreshing} onClick={() => onRefresh()} size="sm" variant="outline">
          <RefreshCw className="size-4" /> {t('common.refresh')}
        </Button>
      </div>
      {connection.lastSyncError ? (
        <Alert className="mt-4" variant="destructive">
          <AlertTriangle />
          <AlertTitle>{t('settings.git.workflow.lastSyncFailed')}</AlertTitle>
          <AlertDescription>
            <FailureMessage context="git" error={connection.lastSyncError} />
          </AlertDescription>
        </Alert>
      ) : null}
    </section>
  );
}

/** Each pull request with its first preview as listed (none yet reads as pending). */
export function GitPullRequestPreviews({ pullRequests }: { pullRequests: GitWorkflowStatus['pullRequests'] }) {
  const { t } = useLocale();
  return (
    <section className="rounded-xl border p-5">
      <h3 className="font-semibold">{t('settings.git.workflow.previewsTitle')}</h3>
      <div className="mt-3 space-y-2">
        {pullRequests.length ? (
          pullRequests.map((pull) => {
            const preview = pull.previews[0];
            return (
              <div className="flex flex-wrap items-center gap-3 rounded-lg border p-3" key={pull.id}>
                <Badge variant={pull.draft ? 'secondary' : 'outline'}>{pull.draft ? t('settings.git.workflow.draft') : pull.state}</Badge>
                <a className="font-medium text-sm underline" href={pull.url} rel="noreferrer" target="_blank">
                  #{pull.number} {pull.title} <ArrowUpRight className="inline size-3" />
                </a>
                <span className="ms-auto text-muted-foreground text-xs">
                  {t('settings.git.workflow.preview')}: {preview?.status ?? t('settings.git.workflow.pending')}
                </span>
                {preview?.url ? (
                  <a className="text-sm underline" href={preview.url} target="_blank" rel="noreferrer">
                    {t('settings.git.workflow.openPreview')}
                  </a>
                ) : null}
              </div>
            );
          })
        ) : (
          <p className="text-muted-foreground text-sm">{t('settings.git.workflow.noPr')}</p>
        )}
      </div>
    </section>
  );
}

/** The operations in the order the status lists them, each with its changed files and failure. */
export function GitRecentOperations({ operations }: { operations: GitWorkflowStatus['operations'] }) {
  const { locale, t } = useLocale();
  return (
    <section className="rounded-xl border p-5">
      <h3 className="font-semibold">{t('settings.git.workflow.recentOperations')}</h3>
      <div className="mt-3 space-y-2">
        {operations.map((item) => (
          <div className="rounded-lg border p-3" key={item.id}>
            <div className="flex items-center gap-2">
              <Badge variant={gitStatusTone(item.status)}>{item.status}</Badge>
              <span className="text-sm">
                {item.kind} {item.commitMessage}
              </span>
              <span className="ms-auto text-muted-foreground text-xs">{new Date(item.createdAt).toLocaleString(localeTag(locale))}</span>
            </div>
            {item.changedFiles?.length ? (
              <ul className="mt-2 text-muted-foreground text-xs">
                {item.changedFiles.map((file) => (
                  <li key={file.path}>
                    {file.status}: <code>{file.path}</code>
                  </li>
                ))}
              </ul>
            ) : null}
            {item.error ? <FailureMessage context="git" error={item.error} /> : null}
          </div>
        ))}
      </div>
    </section>
  );
}
