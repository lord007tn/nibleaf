import { useCallback, useEffect, useRef, useState } from 'react';
import { useGitConflictResolution } from '../api/git-conflict-resolution';
import { conflictResolutionBody, type GitConflictChoice } from '../model/git-conflict-resolution';

type Target = { projectId: string; conflictId: string };
const isFor = (target: Target | null, projectId: string, conflictId: string) => target?.projectId === projectId && target.conflictId === conflictId;

/**
 * The four resolution buttons of one conflict card. One press owns the
 * conflict's resolution until it settles: any other press, of any of the four
 * buttons, in the same tick or later, does nothing until then, and the
 * conflict stays busy while a resolution of it runs, from any instance
 * (leaving and coming back included). Another conflict, or another site, is
 * never made busy by it.
 *
 * The site, the conflict and the body are captured when the press happens.
 * The request is never cancelled or retried; a success refreshes its site's
 * status whatever shows by then, and a failure is reported (`failed`) only
 * while the card it started in still shows that conflict (a language change
 * or a refetch keeps the card; leaving and coming back is a new one).
 */
export function useGitConflictResolutionCommand(projectId: string, conflictId: string) {
  const resolution = useGitConflictResolution(projectId, conflictId);
  const owner = useRef<Target | null>(null);
  const [owned, setOwned] = useState<Target | null>(null);

  // Releases the owner only for the press that holds it.
  const release = useCallback((current: Target) => {
    if (owner.current !== current) return;
    owner.current = null;
    setOwned(null);
  }, []);

  // The card as committed: a new object each time it shows a conflict, null once it is gone.
  const panel = useRef<Target | null>(null);
  useEffect(() => {
    const current = { projectId, conflictId };
    panel.current = current;
    return () => {
      if (panel.current === current) panel.current = null;
    };
  }, [projectId, conflictId]);

  const resolve = (choice: GitConflictChoice, custom: string, failed: (error: unknown) => void) => {
    if (isFor(owner.current, projectId, conflictId) || resolution.isPending()) return;
    const startedPanel = panel.current;
    if (!isFor(startedPanel, projectId, conflictId)) return;
    const current = { projectId, conflictId };
    owner.current = current;
    setOwned(current);
    resolution.send({ projectId, conflictId, body: conflictResolutionBody(choice, custom) }).then(
      () => release(current),
      (error: unknown) => {
        release(current);
        if (panel.current === startedPanel) failed(error);
      },
    );
  };

  return { busy: isFor(owned, projectId, conflictId) || resolution.pending, resolve };
}
