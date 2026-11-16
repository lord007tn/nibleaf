/*
 * Main's connected Git status readouts, copied verbatim from
 * apps/app/src/components/settings/git-workflow.tsx at a804d679 (#788): statusTone, the status header, and the
 * pull request previews and recent operations with their host conditions. Only git-workflow-readouts.test.tsx
 * renders it, as the "before" side of its parity checks, and that test checks each block against `git show` of
 * that commit whenever the history is present. Regenerate it only if the pinned base changes.
 */
import { Alert, AlertDescription, AlertTitle } from '@nibleaf/design-system/components/ui/alert';
import { Badge } from '@nibleaf/design-system/components/ui/badge';
import { Button } from '@nibleaf/design-system/components/ui/button';
import { useLocale } from '@nibleaf/i18n/react';
import { AlertTriangle, ArrowUpRight, GitCompare, RefreshCw } from 'lucide-react';
import { FailureMessage } from '@/components/failure-message';
import type { GitWorkflowStatus } from '@/hooks/api';
import { localeTag } from '@/lib/format';

export const MAIN_READOUTS_BASE = 'a804d679a214b470a6e2c24646b468d4f1cf0e22';

const statusTone = (status: string): 'default' | 'secondary' | 'destructive' | 'outline' =>
  status === 'FAILED' || status === 'CONFLICT' ? 'destructive' : status === 'SUCCEEDED' || status === 'READY' ? 'default' : 'secondary';

/** Main's three readouts in its order, for the given status, panel and query state. */
export function MainReadouts({
  connection,
  intent,
  query,
}: {
  connection: GitWorkflowStatus;
  intent: 'overview' | 'sync' | 'publish' | 'connection';
  query: { isFetching: boolean; refetch: () => unknown };
}) {
  const { locale, t } = useLocale();
  return (
    <div className="flex flex-col gap-6">
      <section className="rounded-xl border border-primary/20 bg-primary/5 p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <GitCompare className="size-5 text-primary" />
              <h2 className="font-semibold">{t('settings.git.workflow.title')}</h2>
              <Badge variant={statusTone(connection.lastSyncStatus)}>{connection.lastSyncStatus}</Badge>
            </div>
            <p className="mt-1 font-mono text-sm">
              {connection.repository}: {connection.headBranch} → {connection.baseBranch}
            </p>
          </div>
          <Button loading={query.isFetching} onClick={() => query.refetch()} size="sm" variant="outline">
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

      {intent === 'overview' || intent === 'publish' ? (
        <section className="rounded-xl border p-5">
          <h3 className="font-semibold">{t('settings.git.workflow.previewsTitle')}</h3>
          <div className="mt-3 space-y-2">
            {connection.pullRequests.length ? (
              connection.pullRequests.map((pull) => {
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
      ) : null}

      {intent === 'overview' || intent === 'sync' ? (
        <section className="rounded-xl border p-5">
          <h3 className="font-semibold">{t('settings.git.workflow.recentOperations')}</h3>
          <div className="mt-3 space-y-2">
            {connection.operations.map((item) => (
              <div className="rounded-lg border p-3" key={item.id}>
                <div className="flex items-center gap-2">
                  <Badge variant={statusTone(item.status)}>{item.status}</Badge>
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
      ) : null}
    </div>
  );
}
