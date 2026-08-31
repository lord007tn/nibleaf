import { Button } from '@nibleaf/design-system/components/ui/button';
import { useConfirm } from '@nibleaf/design-system/components/ui/confirm';
import { Dialog, DialogContent, DialogTitle } from '@nibleaf/design-system/components/ui/dialog';
import { cn } from '@nibleaf/design-system/lib/utils';
import { useT } from '@nibleaf/i18n/react';
import { Check, ExternalLink, Loader2, RotateCcw, TriangleAlert } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { toast } from 'sonner';
import { useDeployments, useRollback } from '@/hooks/api';
import type { DeploymentStatus, Project } from '@/hooks/api/types';
import { completeFirstPublishAttribution, type FirstPublishAttribution } from '@/lib/first-publish-activation';
import { siteHref } from '@/lib/links';

interface DeployPipelineProps {
  project: Project;
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
export function DeployPipeline({ project, open, onOpenChange, trackedAttribution, trackedDeploymentId }: DeployPipelineProps) {
  const rollback = useRollback(project.id);
  const confirm = useConfirm();
  const t = useT();

  const deployments = useDeployments(project.id, { enabled: open || Boolean(trackedDeploymentId), pollIntervalMs: 1500 });

  const deployment = trackedDeploymentId ? deployments.data?.find((item) => item.id === trackedDeploymentId) : deployments.data?.[0];
  const status = deployment?.status;
  const running = status === 'PENDING' || status === 'BUILDING';
  const done = status === 'READY';
  const failed = status === 'FAILED';
  const active = activeStep(status);

  // The previous READY deployment is the rollback target.
  const previousReady = (deployments.data ?? []).find(
    (item) => item.status === 'READY' && item.id !== deployment?.id && (!deployment || item.version < deployment.version),
  );

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

  // Fire the "published" toast exactly once, on transition into READY while the dialog is open.
  const announced = useRef<string | null>(null);
  useEffect(() => {
    if (open && done && deployment && announced.current !== deployment.id) {
      announced.current = deployment.id;
      toast.success(t('deploy.published'), {
        action: {
          label: t('deploy.viewSiteArrow'),
          onClick: () => window.location.assign(siteHref(project.id)),
        },
      });
    }
  }, [open, done, deployment, project.id, t]);

  const viewSite = () => window.location.assign(siteHref(project.id));

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
    rollback.mutate(previousReady.id, {
      onSuccess: () => {
        toast.success(t('deploy.rollback.success', { version: previousReady.version }));
        onOpenChange(false);
      },
      onError: (error) => toast.error(error instanceof Error ? error.message : t('deploy.rollback.error')),
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="gap-0 p-0 sm:max-w-[420px]" showCloseButton={false}>
        <div className="flex flex-col gap-5 px-6 pt-6 pb-2">
          <div className="flex items-center gap-3">
            {done ? (
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
                {done ? t('deploy.deployed') : failed ? t('deploy.failed') : t('deploy.deploying')}
              </DialogTitle>
              <div className="truncate font-mono text-[12.5px] text-muted-foreground">{siteHref(project.id)}</div>
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

          {failed && deployment?.error ? <p className="-mt-1 pb-1 text-destructive text-xs">{deployment.error}</p> : null}
        </div>

        {done ? (
          <div className="flex items-center gap-2.5 px-6 pt-3.5 pb-5">
            <Button variant="outline" disabled={!previousReady || rollback.isPending} onClick={doRollback}>
              {rollback.isPending ? <Loader2 className="size-3.5 animate-spin" /> : <RotateCcw className="size-3.5" />}
              {t('deploy.rollback')}
            </Button>
            <span className="flex-1" />
            <Button variant="outline" onClick={viewSite}>
              {t('deploy.viewSite')} <ExternalLink className="size-3.5" />
            </Button>
            <Button onClick={() => onOpenChange(false)}>{t('deploy.done')}</Button>
          </div>
        ) : failed ? (
          <div className="flex justify-end px-6 pt-3.5 pb-5">
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
