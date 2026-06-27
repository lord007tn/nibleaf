import { useQuery } from '@tanstack/react-query';
import { Check, ExternalLink, Loader2, RotateCcw, TriangleAlert } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { useConfirm } from '@/components/ui/confirm';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { useRollback } from '@/hooks/api';
import { getData } from '@/hooks/api/client-helpers';
import { queryKeys } from '@/hooks/api/query-keys';
import type { Deployment, DeploymentStatus, Project } from '@/hooks/api/types';
import { api } from '@/lib/api';
import { siteHref } from '@/lib/links';
import { cn } from '@/lib/utils';

interface DeployPipelineProps {
  project: Project;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const STEPS = ['Queued', 'Building snapshot', 'Indexing search', 'Live'] as const;

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
      return STEPS.length;
    case 'FAILED':
      return 1;
    default:
      return 0;
  }
}

type StepState = 'done' | 'active' | 'failed' | 'pending';

/** Live deploy progress. Polls the deployments list while building. Faithful to design lines 2143-2178. */
export function DeployPipeline({ project, open, onOpenChange }: DeployPipelineProps) {
  const rollback = useRollback(project.id);
  const confirm = useConfirm();

  const deployments = useQuery({
    queryKey: queryKeys.deployments.all(project.id),
    enabled: open,
    queryFn: async () =>
      getData<Deployment[]>(await api.app.projects[':projectId'].deployments.$get({ param: { projectId: project.id } }), 'deployments'),
    refetchInterval: (query) => {
      const latest = query.state.data?.[0];
      return latest && (latest.status === 'PENDING' || latest.status === 'BUILDING') ? 1500 : false;
    },
  });

  const latest = deployments.data?.[0];
  const status = latest?.status;
  const running = status === 'PENDING' || status === 'BUILDING';
  const done = status === 'READY';
  const failed = status === 'FAILED';
  const active = activeStep(status);

  // The previous READY deployment is the rollback target.
  const previousReady = (deployments.data ?? []).slice(1).find((d) => d.status === 'READY');

  // Fire the "published" toast exactly once, on transition into READY while the dialog is open.
  const announced = useRef<string | null>(null);
  useEffect(() => {
    if (!open) {
      announced.current = null;
      return;
    }
    if (done && latest && announced.current !== latest.id) {
      announced.current = latest.id;
      toast.success('Published — your site is live', {
        action: {
          label: 'View site →',
          onClick: () => window.open(siteHref(project.id), '_blank', 'noopener,noreferrer'),
        },
      });
    }
  }, [open, done, latest, project.id]);

  const viewSite = () => window.open(siteHref(project.id), '_blank', 'noopener,noreferrer');

  const doRollback = async () => {
    if (!previousReady) {
      toast.error('No previous deployment to roll back to.');
      return;
    }
    const ok = await confirm({
      title: 'Roll back',
      description: `Roll back to v${previousReady.version}? Your live site will revert to that version.`,
      confirmLabel: 'Roll back',
      destructive: true,
    });
    if (!ok) {
      return;
    }
    rollback.mutate(previousReady.id, {
      onSuccess: () => {
        toast.success(`Rolled back to v${previousReady.version}`);
        onOpenChange(false);
      },
      onError: (error) => toast.error(error instanceof Error ? error.message : 'Could not roll back'),
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
                {done ? 'Deployed successfully' : failed ? 'Deploy failed' : 'Deploying…'}
              </DialogTitle>
              <div className="truncate font-mono text-[12.5px] text-muted-foreground">{siteHref(project.id)}</div>
            </div>
          </div>

          <ul className="border-border border-t pt-1">
            {STEPS.map((label, i) => {
              const state: StepState = failed && i === active ? 'failed' : i < active ? 'done' : i === active && running ? 'active' : 'pending';
              return (
                <li key={label} className="flex items-center gap-3 py-2.5">
                  <StepIndicator state={state} />
                  <span
                    className={cn(
                      'text-sm',
                      state === 'pending' && 'text-muted-foreground',
                      state === 'failed' && 'text-destructive',
                      (state === 'done' || state === 'active') && 'text-foreground',
                    )}
                  >
                    {label}
                  </span>
                </li>
              );
            })}
          </ul>

          {failed && latest?.error ? <p className="-mt-1 pb-1 text-destructive text-xs">{latest.error}</p> : null}
        </div>

        {done ? (
          <div className="flex items-center gap-2.5 px-6 pt-3.5 pb-5">
            <Button variant="outline" disabled={!previousReady || rollback.isPending} onClick={doRollback}>
              {rollback.isPending ? <Loader2 className="size-3.5 animate-spin" /> : <RotateCcw className="size-3.5" />}
              Roll back
            </Button>
            <span className="flex-1" />
            <Button variant="outline" onClick={viewSite}>
              View site <ExternalLink className="size-3.5" />
            </Button>
            <Button onClick={() => onOpenChange(false)}>Done</Button>
          </div>
        ) : failed ? (
          <div className="flex justify-end px-6 pt-3.5 pb-5">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Close
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
