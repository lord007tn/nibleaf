import { useCallback, useEffect, useRef, useState } from 'react';
import { type GitImportSummary, useGitImport } from '../api/git-import';

/** How one press is reported. Each is called at most once, and only into the Git panel the press started in. */
export type GitImportReport = {
  succeeded: (summary: GitImportSummary) => void;
  failed: (error: unknown) => void;
};

/**
 * The legacy Git connection's "Import now" for the site. One press owns the
 * request until it settles: another press, in the same tick or later, does
 * nothing until then, and the site's import stays busy while a request for it
 * runs, from any instance (leaving for another site and coming back included).
 * An import for one site never makes another busy.
 *
 * The site is captured when the press happens. The request is never cancelled
 * or retried; a success refreshes its site whatever shows by then, and its
 * answer is reported only while the Git panel it started in still shows (a
 * language change keeps the panel; site A → B → A is a new one).
 */
export function useGitImportCommand(projectId: string) {
  const gitImport = useGitImport(projectId);
  const owner = useRef<{ projectId: string } | null>(null);
  const [ownedFor, setOwnedFor] = useState<string | null>(null);

  // Releases the owner only for the press that holds it.
  const release = useCallback((current: { projectId: string }) => {
    if (owner.current !== current) return;
    owner.current = null;
    setOwnedFor(null);
  }, []);

  // The panel as committed: a new object each time it shows a site, null once it is gone.
  const panel = useRef<{ projectId: string } | null>(null);
  useEffect(() => {
    const current = { projectId };
    panel.current = current;
    return () => {
      if (panel.current === current) panel.current = null;
    };
  }, [projectId]);

  const start = (report: GitImportReport) => {
    if (owner.current?.projectId === projectId || gitImport.isPending()) return;
    const startedPanel = panel.current;
    if (startedPanel?.projectId !== projectId) return;
    const current = { projectId };
    owner.current = current;
    setOwnedFor(projectId);
    gitImport.send({ projectId }).then(
      (summary) => {
        release(current);
        if (panel.current === startedPanel) report.succeeded(summary);
      },
      (error: unknown) => {
        release(current);
        if (panel.current === startedPanel) report.failed(error);
      },
    );
  };

  return { busy: ownedFor === projectId || gitImport.pending, start };
}
