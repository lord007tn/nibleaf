import { ActionDialog } from '@nibleaf/design-system/components/ui/action-dialog';
import { useT } from '@nibleaf/i18n/react';
import { useState } from 'react';
import { friendlyErrorMessage, useProject, useRollback } from '@/hooks/api';
import { useProjectAdminStatus } from '@/hooks/use-project-admin-status';
import { DeployPipeline } from '../project/deploy-pipeline';

/**
 * Restoring publishes, so it takes publish rights (Editor or above), as the
 * Publish button does. Without them the action stays visible, disabled, with
 * the reason; while the role is loading or can't be read it waits, too.
 */
export function useRestoreReason(projectId: string): string | undefined {
  const t = useT();
  const edit = useProjectAdminStatus(projectId).edit;
  if (edit === 'edit') return undefined;
  if (edit === 'viewOnly') return t('access.viewOnly.publish');
  return t(edit === 'unknown' ? 'access.unknown.title' : 'access.checking.publish');
}

interface Target {
  id: string;
  version: number;
}

/**
 * "Restore this version" for any published version: the same rollback the
 * publish dialog offers (`useRollback`), confirmed first, then followed in the
 * publish dialog, which reports the restore, a failure with Retry, or that a
 * newer publish went live meanwhile.
 *
 * Returns `request(target)` to open the confirmation and the elements to render.
 */
export function useRestoreVersion(projectId: string) {
  const t = useT();
  const project = useProject(projectId).data;
  const rollback = useRollback(projectId);
  const [confirming, setConfirming] = useState<Target | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [tracked, setTracked] = useState<{ id: string; targetId: string; version: number } | null>(null);
  const [pipelineOpen, setPipelineOpen] = useState(false);

  const request = (target: Target) => {
    setConfirming(target);
    setConfirmOpen(true);
  };

  const elements = (
    <>
      <ActionDialog
        cancelLabel={t('common.cancel')}
        confirmLabel={t('publishes.restore')}
        description={confirming ? t('deploy.rollback.confirmDesc', { version: confirming.version }) : undefined}
        destructive
        errorMessage={(error) => friendlyErrorMessage(t, error, 'deploy.rollback.error')}
        fallbackErrorMessage={t('deploy.rollback.error')}
        onConfirm={async () => {
          if (!confirming) return;
          const queued = await rollback.mutateAsync(confirming.id);
          setTracked({ id: queued.id, targetId: confirming.id, version: confirming.version });
          setPipelineOpen(true);
        }}
        onOpenChange={setConfirmOpen}
        open={confirmOpen}
        title={t('publishes.restore')}
      />
      {project ? (
        <DeployPipeline
          onOpenChange={setPipelineOpen}
          open={pipelineOpen}
          project={project}
          restoring={tracked ? { targetId: tracked.targetId, version: tracked.version } : null}
          trackedDeploymentId={tracked?.id ?? null}
        />
      ) : null}
    </>
  );

  return { request, elements };
}
