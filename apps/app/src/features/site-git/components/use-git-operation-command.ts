import { randomUUID } from '@nibleaf/shared/uuid';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useGitOperation } from '../api/git-operation';
import { type GitOperationPanel, type GitOperationRequest, type GitUpdatePrFields, gitSyncRequest, gitUpdatePrRequest } from '../model/git-operation';

/** Called at most once per press, and only while the panel the press started in still shows. */
type Failed = (error: unknown) => void;

/** An operation panel as shown for a site. */
type Panel = { projectId: string; panel: GitOperationPanel };

/**
 * Sync and Update PR for the site. One press owns the request until it
 * settles: another press, of either action, in the same tick or later, does
 * nothing until then, and the site's operations stay busy while a request for
 * it runs, from any instance. Another site's operations are never busy because
 * of it.
 *
 * A press captures the site and what it sends, and its idempotency key is made
 * only once the press is accepted. The request is never cancelled or retried;
 * its site is refreshed whatever shows by then, and its failure is reported
 * only while the panel it started in still shows (Sync → Update PR → Sync, or
 * site A → B → A, is a new panel).
 *
 * `panel`: the operation panel shown, or null while none is.
 */
export function useGitOperationCommand({ projectId, panel }: { projectId: string; panel: GitOperationPanel | null }) {
  const operation = useGitOperation(projectId);
  const owner = useRef<{ projectId: string } | null>(null);
  const [ownedFor, setOwnedFor] = useState<string | null>(null);

  // Releases the owner only for the press that holds it.
  const release = useCallback((current: { projectId: string }) => {
    if (owner.current !== current) return;
    owner.current = null;
    setOwnedFor(null);
  }, []);

  // The panel as committed: a new object each time one opens for a site, null while none shows.
  const shown = useRef<Panel | null>(null);
  useEffect(() => {
    if (!panel) return;
    const current = { projectId, panel };
    shown.current = current;
    return () => {
      if (shown.current === current) shown.current = null;
    };
  }, [projectId, panel]);

  const start = (from: GitOperationPanel, build: (idempotencyKey: string) => GitOperationRequest, failed: Failed) => {
    if (owner.current?.projectId === projectId || operation.isPending()) return;
    const startedPanel = shown.current;
    if (startedPanel?.projectId !== projectId || startedPanel.panel !== from) return;
    const current = { projectId };
    owner.current = current;
    setOwnedFor(projectId);
    operation.send(build(randomUUID())).then(
      () => release(current),
      (error: unknown) => {
        release(current);
        if (shown.current === startedPanel) failed(error);
      },
    );
  };

  return {
    busy: ownedFor === projectId || operation.pending,
    sync: (baseBranch: string, failed: Failed) => start('sync', (key) => gitSyncRequest(projectId, key, baseBranch), failed),
    updatePr: (fields: GitUpdatePrFields, failed: Failed) => start('publish', (key) => gitUpdatePrRequest(projectId, key, fields), failed),
  };
}
