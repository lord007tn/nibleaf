import { Button } from '@nibleaf/design-system/components/ui/button';
import { useConfirm } from '@nibleaf/design-system/components/ui/confirm';
import { Dialog, DialogContent, DialogTitle } from '@nibleaf/design-system/components/ui/dialog';
import { cn } from '@nibleaf/design-system/lib/utils';
import { useT } from '@nibleaf/i18n/react';
import { Check, ExternalLink, Loader2, RotateCcw, TriangleAlert } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { friendlyErrorMessage, useDeployments, useDomains, useLiveDeployments, useRollback } from '@/hooks/api';
import { rollbackTarget } from '@/hooks/api/deployment-cache';
import { pickLiveDomain } from '@/hooks/api/domain-state';
import type { Deployment, DeploymentStatus, Project } from '@/hooks/api/types';
import { completeFirstPublishAttribution, type FirstPublishAttribution } from '@/lib/first-publish-activation';
import { canonicalSiteBase, type SiteUrlOptions, sitePageUrl } from '@/lib/site-seo';

export interface PublishPage {
  path: string;
  title: string;
  languageCode?: string;
  /** Web-address prefix of a NON-default docs version (e.g. `v2`); unset for the default version. */
  versionSlug?: string;
}

/** The published address of a page: `<site>/<version>/<path>?lang=<code>`, with the
 *  version segment only for a non-default version (the site's URL convention). */
export const publishedPageUrl = (projectId: string, page: PublishPage, site?: SiteUrlOptions): string =>
  sitePageUrl(projectId, [page.versionSlug, ...page.path.split('/')].filter(Boolean).join('/'), page.languageCode, site);

/** What a failed publish reported, for the "What went wrong" details: the
 *  per-page check issues when there are any, else the raw error text. */
export const publishFailureDetails = (deployment: Pick<Deployment, 'error' | 'errorDetails'> | undefined): string[] => {
  const issues = (Array.isArray(deployment?.errorDetails) ? deployment.errorDetails : []).flatMap((issue) =>
    issue && typeof issue.detail === 'string' ? [[issue.pageTitle || issue.pagePath, issue.detail].filter(Boolean).join(' — ')] : [],
  );
  if (issues.length > 0) return [...new Set(issues)];
  const error = deployment?.error?.trim();
  return error ? [error] : [];
};

interface DeployPipelineProps {
  /** The page the writer is on: "Your changes are live" links to its published address. */
  currentPage?: PublishPage;
  project: Project;
  onRetry?: () => void;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  trackedAttribution?: FirstPublishAttribution | null;
  trackedDeploymentId?: string | null;
}

const STEP_KEYS = ['deploy.step.queued', 'deploy.step.building', 'deploy.step.indexing', 'deploy.step.live'] as const;

/**
 * Maps a deployment status to how far the pipeline has progressed.
 * Returns the index of the first not-yet-complete (active) step.
 *  - PENDING  → 0 (Queued active)
 *  - BUILDING → 1..2 (snapshot/index active; Queued done)
 *  - READY    → 4 (all done)
 *  - FAILED   → active step shows the error
 */
function activeStep(status: DeploymentStatus | undefined): number {
  switch (status) {
    case 'PENDING':
      return 0;
    case 'BUILDING':
      return 1;
    case 'READY':
      return STEP_KEYS.length;
    case 'FAILED':
      return 1;
    default:
      return 0;
  }
}

type StepState = 'done' | 'active' | 'failed' | 'pending';

/** Live deploy progress. Polls the deployments list while building. Faithful to design lines 2143-2178. */
export function DeployPipeline({ project, open, onOpenChange, trackedAttribution, trackedDeploymentId, onRetry, currentPage }: DeployPipelineProps) {
  const domains = useDomains(project.id);
  const siteOptions: SiteUrlOptions = {
    slug: project.slug,
    // Only a domain readers can open (ownership, DNS and HTTPS), as on the site overview.
    primaryDomain: domains.data ? pickLiveDomain(domains.data)?.domain : undefined,
  };
  const siteUrl = canonicalSiteBase(project.id, siteOptions);
  const livePage = currentPage;
  const pageUrl = livePage ? publishedPageUrl(project.id, livePage, siteOptions) : null;
  const rollback = useRollback(project.id);
  const confirm = useConfirm();
  const t = useT();

  const [restoreRequest, setRestoration] = useState<{
    id: string;
    targetId: string;
    version: number;
    projectId: string;
    sourceId: string | null | undefined;
  } | null>(null);
  const restoration = restoreRequest?.projectId === project.id && restoreRequest.sourceId === trackedDeploymentId ? restoreRequest : null;
  const observedDeploymentId = restoration?.id ?? trackedDeploymentId;
  const deployments = useDeployments(project.id, {
    enabled: open || Boolean(observedDeploymentId),
    pollIntervalMs: 1500,
    retryingDeploymentId: observedDeploymentId,
  });

  const deployment = observedDeploymentId ? deployments.data?.find((item) => item.id === observedDeploymentId) : deployments.data?.[0];
  const status = deployment?.status;
  const retrying = Boolean(observedDeploymentId) && status === 'FAILED' && deployment?.completedAt === null;
  const running = status === 'PENDING' || status === 'BUILDING' || retrying;
  const done = status === 'READY';
  const failed = status === 'FAILED' && !retrying;
  const superseded = Boolean(
    restoration && done && deployment && deployments.data?.some((item) => item.status === 'READY' && item.version > deployment.version),
  );
  const reviewRequired = deployment?.errorDetails && !Array.isArray(deployment.errorDetails) && deployment.errorDetails.reason === 'review_stale';
  const failureDetails = failed ? (reviewRequired ? [t('publish.reviewChanged')] : publishFailureDetails(deployment)) : [];
  const active = activeStep(retrying ? 'PENDING' : status);

  // The rollback target: the newest live publish before this one, from the
  // live-only list too, so it survives more than 50 failed attempts.
  const liveDeployments = useLiveDeployments(project.id, { enabled: open });
  // Never from a list that is being re-read, or whose last re-read failed (the
  // query keeps its old data then): a stale answer can miss a newer live version
  // and pick an older target. The polled list still answers — a live version
  // older than this one that it lists is the right target.
  const trustedLive = liveDeployments.isError ? undefined : liveDeployments.data;
  const previousReady = liveDeployments.isFetching ? undefined : rollbackTarget(deployments.data, trustedLive, deployment);

  // Keep polling the exact mutation result after the dialog closes. The
  // worker owns the READY receipt; the client consumes local attribution only
  // after that same deployment reaches READY.
  const completedAttribution = useRef<string | null>(null);
  useEffect(() => {
    if (deployment && done && trackedAttribution && deployment.id === trackedDeploymentId && completedAttribution.current !== deployment.id) {
      completedAttribution.current = deployment.id;
      completeFirstPublishAttribution(trackedAttribution);
    }
  }, [deployment, done, trackedAttribution, trackedDeploymentId]);

  // Announce each tracked outcome once, including after the dialog closes.
  const announced = useRef(new Set<string>());
  useEffect(() => {
    const outcome = superseded ? 'superseded' : 'ready';
    if (done && deployment && (open || deployment.id === observedDeploymentId) && !announced.current.has(`${deployment.id}:${outcome}`)) {
      announced.current.add(`${deployment.id}:${outcome}`);
      if (superseded) {
        toast.info(t('deploy.rollback.superseded'));
      } else {
        toast.success(restoration ? t('deploy.rollback.success', { version: restoration.version }) : t('deploy.published'), {
          action: {
            label: t('deploy.viewSiteArrow'),
            onClick: () => window.open(siteUrl, '_blank', 'noopener,noreferrer'),
          },
        });
      }
    }
    if (failed && restoration && deployment?.id === restoration.id && !announced.current.has(`${deployment.id}:failed`)) {
      announced.current.add(`${deployment.id}:failed`);
      toast.error(t('deploy.rollback.error'));
    }
  }, [open, done, failed, deployment, siteUrl, t, observedDeploymentId, restoration, superseded]);

  const viewSite = () => window.open(siteUrl, '_blank', 'noopener,noreferrer');

  const restoreVersion = (targetId: string, version: number) => {
    rollback.mutate(targetId, {
      onSuccess: (queued) => {
        setRestoration({ id: queued.id, targetId, version, projectId: project.id, sourceId: trackedDeploymentId });
      },
      onError: (error) => toast.error(friendlyErrorMessage(t, error, 'deploy.rollback.error')),
    });
  };

  const doRollback = async () => {
    if (!previousReady) {
      toast.error(t('deploy.rollback.none'));
      return;
    }
    const ok = await confirm({
      title: t('deploy.rollback'),
      description: t('deploy.rollback.confirmDesc', { version: previousReady.version }),
      confirmLabel: t('deploy.rollback'),
      destructive: true,
    });
    if (!ok) {
      return;
    }
    restoreVersion(previousReady.id, previousReady.version);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="gap-0 p-0 sm:max-w-[420px]" showCloseButton={true}>
        <div className="flex flex-col gap-5 px-6 pt-6 pb-2">
          <div className="flex items-center gap-3">
            {superseded ? (
              <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-secondary text-muted-foreground">
                <TriangleAlert className="size-4" />
              </span>
            ) : done ? (
              <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
                <Check className="size-4" />
              </span>
            ) : failed ? (
              <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-destructive/10 text-destructive">
                <TriangleAlert className="size-4" />
              </span>
            ) : (
              <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-secondary text-primary">
                <Loader2 className="size-4 animate-spin" />
              </span>
            )}
            <div className="min-w-0 leading-snug">
              <DialogTitle className="font-semibold text-base tracking-tight">
                {superseded
                  ? t('deploy.rollback.supersededTitle')
                  : done
                    ? t('deploy.deployed')
                    : failed
                      ? t('deploy.failed')
                      : restoration
                        ? t('deploy.rollback.restoring', { version: restoration.version })
                        : t('deploy.deploying')}
              </DialogTitle>
              {superseded ? <p className="mt-1 text-muted-foreground text-sm">{t('deploy.rollback.superseded')}</p> : null}
              <div className="truncate font-mono text-[12.5px] text-muted-foreground" dir="ltr">
                {siteUrl}
              </div>
            </div>
          </div>

          <ul className="border-border border-t pt-1">
            {STEP_KEYS.map((key, i) => {
              const state: StepState = failed && i === active ? 'failed' : i < active ? 'done' : i === active && running ? 'active' : 'pending';
              return (
                <li key={key} className="flex items-center gap-3 py-2.5">
                  <StepIndicator state={state} />
                  <span
                    className={cn(
                      'text-sm',
                      state === 'pending' && 'text-muted-foreground',
                      state === 'failed' && 'text-destructive',
                      (state === 'done' || state === 'active') && 'text-foreground',
                    )}
                  >
                    {t(key)}
                  </span>
                </li>
              );
            })}
          </ul>

          {failed ? (
            <div className="-mt-1 flex flex-col gap-2 pb-1">
              <p className="text-destructive text-xs" dir="auto">
                {t('publish.failed')}
              </p>
              {/* The reason, so a writer can fix it (or paste it to support)
                  instead of retrying blind. */}
              {failureDetails.length > 0 ? (
                <details className="rounded-md border border-border text-xs">
                  <summary className="cursor-pointer px-3 py-2 font-medium text-foreground pointer-coarse:py-3">{t('deploy.failedDetails')}</summary>
                  <ul className="max-h-40 space-y-1 overflow-y-auto border-border border-t px-3 py-2 text-muted-foreground select-text">
                    {failureDetails.map((detail) => (
                      <li className="break-words" dir="auto" key={detail}>
                        {detail}
                      </li>
                    ))}
                  </ul>
                </details>
              ) : null}
            </div>
          ) : null}
        </div>

        {done ? (
          <div className="flex flex-wrap items-center gap-2.5 px-6 pt-3.5 pb-5">
            {pageUrl ? (
              <a className="w-full text-sm text-primary underline" href={pageUrl} target="_blank" rel="noopener noreferrer" dir="auto">
                {livePage?.title}
              </a>
            ) : null}
            {!superseded ? (
              <details className="w-full text-sm text-muted-foreground">
                <summary className="cursor-pointer">{t('deploy.rollback')}</summary>
                <Button variant="outline" disabled={!previousReady} loading={rollback.isPending || liveDeployments.isFetching} onClick={doRollback}>
                  <RotateCcw className="size-3.5" />
                  {t('deploy.rollback')}
                </Button>
              </details>
            ) : null}
            <span className="flex-1" />
            <Button variant="outline" onClick={viewSite}>
              {t('deploy.viewSite')} <ExternalLink className="size-3.5" />
            </Button>
            <Button onClick={() => onOpenChange(false)}>{t('deploy.done')}</Button>
          </div>
        ) : failed ? (
          <div className="flex justify-end gap-2 px-6 pt-3.5 pb-5">
            {restoration ? (
              <Button loading={rollback.isPending} onClick={() => restoreVersion(restoration.targetId, restoration.version)}>
                {t('common.retry')}
              </Button>
            ) : onRetry ? (
              <Button onClick={onRetry}>{t('common.retry')}</Button>
            ) : null}
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              {t('deploy.close')}
            </Button>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function StepIndicator({ state }: { state: StepState }) {
  if (state === 'done') {
    return (
      <span className="grid size-4 shrink-0 place-items-center rounded-full bg-primary/10 text-primary">
        <Check className="size-2.5" />
      </span>
    );
  }
  if (state === 'active') {
    return <Loader2 className="size-4 shrink-0 animate-spin text-primary" />;
  }
  if (state === 'failed') {
    return (
      <span className="grid size-4 shrink-0 place-items-center rounded-full bg-destructive/10 text-destructive">
        <TriangleAlert className="size-2.5" />
      </span>
    );
  }
  return (
    <span className="grid size-4 shrink-0 place-items-center">
      <span className="size-1.5 rounded-full bg-muted-foreground/40" />
    </span>
  );
}
